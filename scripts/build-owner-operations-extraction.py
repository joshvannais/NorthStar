"""Reproduce the additive pure-rule extraction from immutable migration sources.

Not a migration runner. Run locally to regenerate 064 before freezing a candidate.
Assertions make every paid replacement exact and reviewable; no catalog rewriting.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
def source(number):
    return next((root / 'migrations').glob(number + '_*.sql')).read_text(encoding='utf8')
def function(text, name):
    match = re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.' + name + r'\(', text)
    assert match, name
    tail = text[match.start():]
    delimiter = re.search(r'AS (\$[a-z_]*\$)', tail).group(1)
    end = tail.index(delimiter + ';', tail.index(delimiter) + len(delimiter)) + len(delimiter) + 1
    return tail[:end].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
def replace(text, before, after):
    assert text.count(before) == 1, before[:120]
    return text.replace(before, after)

s38, s48, s49 = source('038'), source('048'), source('049')
transition = function(s38, 'canonical_field_execution_transition')
start = transition.index('  after_state_value := CASE')
end = transition.index('  IF after_state_value IS NULL', start)
transition = transition[:start] + '  after_state_value := public.canonical_work_lifecycle_after(execution_record.lifecycle_state,action_code_value,NULL);\n' + transition[end:]
lifecycle = """CREATE FUNCTION public.canonical_work_lifecycle_after(before_state TEXT, action_value TEXT, return_state TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE
  WHEN before_state='not_started' AND action_value='start' THEN 'in_progress'
  WHEN before_state='in_progress' AND action_value='pause' THEN 'paused'
  WHEN before_state='paused' AND action_value='resume' THEN 'in_progress'
  WHEN before_state IN ('in_progress','paused','reopened') AND action_value='propose_completion' THEN 'completion_pending'
  WHEN before_state='completion_pending' AND action_value='approve_completion' THEN 'completed'
  WHEN before_state='completion_pending' AND action_value='withdraw_completion' AND return_state IN ('in_progress','paused','reopened') THEN return_state
  WHEN before_state IN ('not_started','in_progress','paused','completion_pending','reopened') AND action_value='cancel_execution' THEN 'cancelled'
  WHEN before_state='completed' AND action_value='reopen_execution' THEN 'reopened'
  WHEN before_state='reopened' AND action_value='resume_reopened' THEN 'in_progress'
  WHEN before_state IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled') AND action_value='correct_completion' THEN before_state
  ELSE NULL END
$$;
"""
completion = function(s49, 'canonical_completion_mutate').replace('public.canonical_completion_mutate(', 'public.canonical_completion_mutate_v049(', 1)
for before in ["after_state_value:='completion_pending'", "after_state_value:='completed'", 'after_state_value:=proposal_record.lifecycle_before', "after_state_value:='cancelled'", "after_state_value:='reopened'", "after_state_value:='in_progress'", 'after_state_value:=before_state_value']:
    completion = replace(completion, before, 'after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before)')

progress = function(s48, 'canonical_progress_mutate')
start = progress.index("  IF action_value='review' THEN document_value:=subject_record.document")
end = progress.index('\n ELSE root_value:=record_id;', start)
block = progress[start:end]
successor = """CREATE FUNCTION public.canonical_operations_progress_successor_document(action_value TEXT, previous_document JSONB, evidence_type_value TEXT, document_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF action_value NOT IN ('review','issue_state','correct','update_progress') OR previous_document IS NULL
  OR public.canonical_progress_document_valid(action_value,document_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Invalid operational input' USING ERRCODE='22023'; END IF;
""" + block.replace('subject_record.document', 'previous_document').replace('subject_record.evidence_type', 'evidence_type_value') + """
 IF public.canonical_progress_full_document_valid(document_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Invalid canonical document' USING ERRCODE='22023'; END IF;
 RETURN document_value;
END $$;
"""
progress = progress[:start] + '  document_value:=public.canonical_operations_progress_successor_document(action_value,subject_record.document,subject_record.evidence_type,document_value);' + progress[end:]

snapshot = function(s49, 'canonical_completion_gate_snapshot')
start = snapshot.index(' checklist_passed:=')
reduction = snapshot[start:snapshot.rindex('END $$;')]
args = [('execution_id_value','UUID'),('assignment_value','JSONB'),('gate_requirements_value','JSONB')]
args += [(n, 'JSONB') for n in ('checklist_gates','inspection_gates','file_gates','labor_rows','material_rows','progress_rows','field_rows','equipment_rows')]
args += [(n, 'BIGINT') for n in ('labor_open','labor_review','material_review','progress_unresolved','progress_review','field_review','field_expired','equipment_checkout','equipment_downtime','equipment_fault')]
reduction = replace(reduction, "jsonb_build_object('id',assignment_record.id,'revision',assignment_record.revision,\n    'digest',rtrim(assignment_record.canonical_digest))", 'assignment_value')
reducer = 'CREATE FUNCTION public.canonical_completion_reduce_gates(\n ' + ',\n '.join(n+' '+t for n,t in args) + ''') RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE checklist_passed BOOLEAN; inspection_passed BOOLEAN; file_passed BOOLEAN; hard_passed BOOLEAN;
BEGIN
 IF execution_id_value IS NULL OR assignment_value IS NULL OR public.canonical_completion_requirements_valid(gate_requirements_value) IS NOT TRUE
''' + '\n'.join("  OR jsonb_typeof("+n+") IS DISTINCT FROM 'array'" for n,t in args[3:11]) + '\n' + '\n'.join('  OR '+n+' IS NULL OR '+n+'<0' for n,t in args[11:]) + ''' THEN
  RAISE EXCEPTION 'Complete evidence inputs required' USING ERRCODE='22023'; END IF;
''' + reduction + 'END $$;\n'
callargs = [n for n,t in args]
callargs[1] = "jsonb_build_object('id',assignment_record.id,'revision',assignment_record.revision,'digest',rtrim(assignment_record.canonical_digest))"
snapshot = snapshot[:start] + ' RETURN public.canonical_completion_reduce_gates(\n  '+',\n  '.join(callargs)+');\nEND $$;'

header = '''-- Owner Operations demo parity. Applied migrations 001–063 remain immutable.
-- Pure rules below have no relation reads, paid authority or writes. Existing paid
-- entry functions retain their loaders/auth/locks/receipts; 051 wrapper remains.
-- Generated reproducibly by scripts/build-owner-operations-extraction.py.
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check
 CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action'));

'''
demo_loader = snapshot.replace('public.canonical_completion_gate_snapshot(', 'public.canonical_demo_completion_gate_snapshot(', 1)
demo_loader = demo_loader.replace('gate_requirements_value JSONB\n)', 'gate_requirements_value JSONB, assignment_value JSONB, evidence_value JSONB, evaluated_at TIMESTAMPTZ\n)', 1)
demo_loader = demo_loader.replace('STABLE SECURITY DEFINER', 'IMMUTABLE', 1)
loader_start = demo_loader.index(' SELECT assignment.* INTO assignment_record')
loader_end = demo_loader.index('\n WITH current_rows AS', loader_start)
demo_loader = demo_loader[:loader_start] + """
 IF evaluated_at IS NULL OR evidence_value->>'complete' IS DISTINCT FROM 'true'
 OR jsonb_typeof(evidence_value->'labor') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'materials') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'progress') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'field') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'equipmentEvents') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'equipmentLedgers') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Complete isolated evidence required' USING ERRCODE='22023'; END IF;
 assignment_record:=jsonb_populate_record(NULL::public.canonical_schedule_assignments,assignment_value);
 IF assignment_record.id IS NULL OR assignment_record.revision IS NULL OR assignment_record.canonical_digest IS NULL THEN
  RAISE EXCEPTION 'Current assignment required' USING ERRCODE='22023'; END IF;
""" + demo_loader[loader_end:]
for table,key in [('canonical_labor_intervals','labor'),('canonical_material_movements','materials'),('canonical_progress_records','progress'),('canonical_field_evidence_records','field'),('canonical_equipment_events','equipmentEvents'),('canonical_equipment_ledgers','equipmentLedgers')]:
    demo_loader = demo_loader.replace('public.'+table+' ', "jsonb_populate_recordset(NULL::public."+table+",evidence_value->'"+key+"') ")
demo_loader = demo_loader.replace('transaction_timestamp()', 'evaluated_at')
assert not re.search(r'(?:FROM|JOIN) public\.', demo_loader)
validation = """CREATE FUNCTION public.canonical_operations_document_valid(domain_value TEXT, action_value TEXT, document_value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN domain_value='progress' THEN public.canonical_progress_full_document_valid(document_value)
 WHEN domain_value='evidence' THEN public.canonical_field_evidence_document_valid(action_value,document_value)
 ELSE FALSE END
$$;
"""
# Definer permissions expose only deterministic computation, never table/source access.
# Existing validators/digest helpers are intentionally not individually granted.
successor=successor.replace('LANGUAGE plpgsql IMMUTABLE SET','LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET')
reducer=reducer.replace('LANGUAGE plpgsql IMMUTABLE SET','LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET')
demo_loader=demo_loader.replace('LANGUAGE plpgsql IMMUTABLE\n','LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER\n')
out = header + '\n\n'.join([lifecycle,successor,reducer,validation,transition,progress,completion,snapshot,demo_loader]) + '\n'
for definition in [lifecycle,successor,reducer,validation,demo_loader]:
    signature=definition[definition.index('public.'):definition.index(')')+1]
    # Preserve parameter names in CREATE, use types-only signatures for ACL.
    name,parameters=signature.split('(',1)
    types=','.join(p.strip().split(' ',1)[1] for p in parameters[:-1].split(','))
    out+='REVOKE ALL ON FUNCTION '+name+'('+types+') FROM PUBLIC;\n'
(root/'migrations/064_owner_operations_demo_parity.sql').write_text(out,encoding='utf8',newline='\n')
print('Generated 064: pure lifecycle, progress successor and eleven-gate reduction; exact paid extraction asserted.')
