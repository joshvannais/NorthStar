'use strict';

function denied(cause) {
  const error = new Error('Only the direct assignee, current crew lead, or an owner-delegated worker can control this job.');
  Object.assign(error, { status: 403, statusCode: 403, code: 'JOB_CONTROL_FORBIDDEN', cause });
  return error;
}

async function requireJobControl(client, input, selector) {
  const result = await client.query(
    `SELECT public.canonical_job_control_authority(
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::boolean,$7::uuid,$8::uuid
     ) AS authority`,
    [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,
      input.csrfToken || null,true,selector.appointmentId || null,selector.executionId || null]
  );
  const authority = result.rows[0] && result.rows[0].authority;
  if (!authority || authority.allowed !== true) throw denied();
  return authority;
}

module.exports={requireJobControl};
