'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const policy = () => JSON.parse(read('config/mission27-launch-contract.v1.json'));
const document = () => read('docs/architecture/MISSION_27_PART1D_LAUNCH_CONTRACT.md');

describe('Mission 27 Part 1D first-supported-launch contract', () => {
  test('is one frozen provider-disabled policy with exact-money semantics', () => {
    const value = policy();
    expect(value.contractVersion).toBe('mission27.launch.v1');
    expect(value.policyState).toBe('frozen_provider_disabled');
    expect(value.currency).toEqual({
      code: 'USD',
      minorUnitExponent: 2,
      rounding: 'half_away_from_zero_at_owning_boundary',
      foreignExchangeSupported: false,
    });
    expect(value.rollout.currentStage).toBe('disabled');
    expect(value.rollout.serverOwnedTenantFlagDefault).toBe('off');
    expect(value.financial.liveModeDefaultEnabled).toBe(false);
  });

  test('freezes exact authenticated phone and bounded photo source classes', () => {
    const { phone, photo } = policy().sources;
    expect(phone).toMatchObject({
      class: 'retell.inbound.completed.v1', supported: true, currentRuntimeAvailable: false,
      maximumDurationSeconds: 14400, maximumTranscriptBytes: 524288,
    });
    expect(phone.requires).toEqual(expect.arrayContaining([
      'authenticated_final_completed_lifecycle', 'current_caller_consent',
      'current_retention_authority', 'immutable_final_transcript_digest', 'human_review',
    ]));
    expect(phone.excluded).toEqual(expect.arrayContaining([
      'outbound_call', 'live_or_incomplete_call', 'demo_or_sample_call',
      'provider_id_without_authenticated_lifecycle',
    ]));
    expect(photo).toMatchObject({
      class: 'northstar.quoted_job_photo.v1', supported: true, currentRuntimeAvailable: false,
      maximumFiles: 10, maximumBytesPerFile: 10485760, maximumBytesPerIntake: 52428800,
      maximumPixelsPerFile: 24000000, maximumDimensionPixels: 8192, rawRetentionDays: 30,
    });
    expect(photo.contentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(photo.excluded).toEqual(expect.arrayContaining([
      'heic', 'pdf', 'video', 'signature_media',
      'field_execution_evidence_relabelled_as_quote_intake',
    ]));
  });

  test('selects a server-only extraction mode that cannot accept facts or act', () => {
    const extraction = policy().extraction;
    expect(extraction).toMatchObject({
      adapter: 'openai.responses.structured.v1',
      mode: 'server_side_schema_constrained_store_false',
      currentRuntimeAvailable: false,
      maximumWallClockSeconds: 30,
      maximumCandidatesPerIntake: 200,
      providerToolsEnabled: false,
      browserInferenceEnabled: false,
      automaticFactAcceptance: false,
      automaticCommercialAction: false,
    });
    expect(extraction.requiresExactPins).toEqual([
      'provider', 'model', 'build', 'config', 'schema', 'source_digest',
    ]);
    expect(extraction.blockedUntil).toContain('independent_acceptance');
  });

  test('freezes bounded options, typed signature and action-specific team grants', () => {
    const value = policy();
    expect(value.estimatePolicy).toMatchObject({
      maximumActiveOptions: 3,
      maximumLinesPerOption: 100,
      maximumLinesPerEstimate: 300,
      maximumAssumptionsPerOption: 50,
      maximumProposalValidityDays: 30,
      independentOptionTotals: true,
      machineDraftCanApprovePrice: false,
    });
    expect(value.signaturePolicy).toMatchObject({
      method: 'typed_name_explicit_consent_v1',
      maximumRecipientsPerProposal: 1,
      maximumPublicSessionHours: 168,
      drawnOrBiometricSignatureSupported: false,
      automaticDeliverySupported: false,
      legalSufficiencyClaimed: false,
    });
    expect(value.team.roleAloneAuthorizes).toBe(false);
    expect(value.team.ownerDefaultCapabilities).toHaveLength(25);
    expect(value.team.adminDefaultCapabilities).not.toEqual(expect.arrayContaining([
      'customer_financial.provider.connect',
      'customer_financial.record.delete',
      'customer_financial.record.recover',
    ]));
    expect(value.team.memberDefaultCapabilities).toEqual([]);
    expect(value.team.memberGrantableCapabilities).toEqual([
      'customer_financial.source.review',
      'customer_financial.estimate.edit_draft',
      'customer_financial.estimate.edit_options',
    ]);
    expect(value.team.recentAuthSeconds).toBe(600);
    expect(value.team.mfaFreshnessSeconds).toBe(600);
    expect(value.team.independentApprovalSeconds).toBe(600);
  });

  test('pins the five layouts and owning-mission seams without receiver mutation', () => {
    const value = policy();
    expect(value.mobile.requiredLayouts).toEqual([
      { name: 'narrow_phone_dark', width: 360, height: 800, theme: 'dark' },
      { name: 'standard_phone_light', width: 390, height: 844, theme: 'light' },
      { name: 'portrait_tablet_dark', width: 768, height: 1024, theme: 'dark' },
      { name: 'landscape_tablet_light', width: 1024, height: 768, theme: 'light' },
      { name: 'desktop_dark', width: 1440, height: 900, theme: 'dark' },
    ]);
    expect(value.mobile.browserEngines).toEqual(['chrome', 'playwright_webkit']);
    expect(value.handoff).toMatchObject({
      adapter: 'mission23.work_intake.review.v1',
      supportedAsReviewedRequest: true,
      currentReceivingAdapterAvailable: false,
      createsAppointment: false,
      createsAssignment: false,
      createsDispatch: false,
      createsExecution: false,
      createsInvoice: false,
    });
    expect(value.learning.currentAdapterAvailable).toBe(false);
    expect(value.learning.automaticApplication).toBe(false);
    expect(value.capacityRisk.mode).toBe('read_only_advice');
    expect(value.capacityRisk.mayBookOrMutate).toBe(false);
    expect(value.mission32).toMatchObject({
      adapter: 'polaris.estimate_studio.adapter.v1',
      minimumCompatibleVersion: 1,
      maximumCompatibleVersion: 1,
      mayCreateParallelEstimate: false,
      mayDuplicateAcceptedMath: false,
      mayApproveCommercialRevision: false,
      mayScheduleOrDispatch: false,
    });
  });

  test('freezes contractor-owned Stripe card flow and exact launch geography', () => {
    const financial = policy().financial;
    expect(financial).toMatchObject({
      merchantOfRecord: 'contractor_business',
      northstarCustodyOrControl: false,
      provider: 'stripe_connect',
      providerAccountShape: 'tenant_bound_contractor_account',
      onboarding: 'provider_hosted',
      checkout: 'provider_hosted_direct_charge',
      fundsDestination: 'contractor_connected_account',
      supportedMode: 'test',
      supportedCountry: 'US',
      supportedSubdivisionScope: '50_states_and_district_of_columbia',
      supportedCurrency: 'USD',
      supportedOnlineMethods: ['card'],
      partialProviderPayments: false,
      multiInvoiceProviderPayments: false,
      savedPaymentMethods: false,
      automaticCollection: false,
    });
    expect(financial.tax.providerCalculationEnabled).toBe(false);
    expect(financial.tax.supportedOnlyFromExactMission24Decision).toBe(true);
    expect(financial.accounting).toMatchObject({
      adapter: 'quickbooks_online.accounting_export.v1',
      supportedMode: 'sandbox',
      currentRuntimeAvailable: false,
      mayInventChartOfAccounts: false,
      mayDecideRecognitionOrTax: false,
      maySupplyCheckClearance: false,
    });
    expect(financial.numbering.reuseAllowed).toBe(false);
    expect(financial.numbering.gapsAllowed).toBe(true);
    expect(financial.numbering.yearResetAllowed).toBe(false);
  });

  test('keeps cash, check receipt, clearance and settled balances distinct', () => {
    const offline = policy().financial.offline;
    expect(offline).toEqual({
      cashReceiptEnabled: true,
      checkReceiptEnabled: true,
      checkClearedTransitionEnabled: false,
      checkClearanceAuthority: 'unavailable_until_authenticated_bank_source',
      cashEffect: 'accepted_offline_receipt_reduces_collectible_balance_without_provider_settlement_claim',
      checkEffect: 'pending_tender_only_face_and_settled_balances_unchanged_collection_action_blocked',
      returnedCheckEffect: 'pending_tender_reversed_full_balance_collectible',
      correctionEffect: 'append_only_replacement_or_reversal_never_in_place',
    });
    expect(policy().unavailableCodes).toContain('check_clearance_authority_unavailable');
    expect(document()).toContain('check received — clearance unknown');
    expect(document()).toContain('Human attestation, QuickBooks export/acknowledgement, a photo or free text cannot claim bank clearance.');
  });

  test('sets exact deposit, payment, refund, write-off and dual-control ceilings', () => {
    const value = policy();
    expect(value.financial.deposit).toMatchObject({
      enabled: true,
      requiresExactMission24Schedule: true,
      maximumBasisPoints: 5000,
      maximumMinorUnits: '2500000',
      separateInvoiceRequired: true,
    });
    expect(value.amountPolicy).toMatchObject({
      invoiceMaximumMinorUnits: '10000000',
      cardCheckoutMinimumMinorUnits: '50',
      cardCheckoutMaximumMinorUnits: '10000000',
      offlineCashMaximumMinorUnits: '1000000',
      offlineCheckMaximumMinorUnits: '1000000',
      correctionMaximumAbsoluteDeltaMinorUnits: '2500000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      liveProviderConnectionAlwaysRequiresTwoHumans: true,
      recordDeletionAlwaysRequiresTwoHumans: true,
    });
    expect(value.amountPolicy.singleControlMaximums).toEqual({
      proposal_signature_work_handoff_invoice_approval_issue_send: '1000000',
      offline_cash_or_check_receipt: '100000',
      refund: '100000',
      write_off: '50000',
      commercial_correction_delta: '100000',
    });
    expect(value.financial.refund.maximumMinorUnitsPerAction).toBe('10000000');
    expect(value.financial.writeOff.maximumMinorUnitsPerAction).toBe('1000000');
    for (const unsupported of [
      'progressBilling', 'milestoneBilling', 'retainage', 'tips', 'surcharges',
      'financing', 'recurringBilling',
    ]) expect(value.financial[unsupported]).toBe(false);
  });

  test('freezes billable sources, retention, professional gates and release sequence', () => {
    const value = policy();
    expect(value.billableWork.finalBalance).toEqual({
      supported: true,
      requires: [
        'exact_current_mission24_accepted_option_and_commercial_revision',
        'exact_current_mission23_completion_evidence',
        'explicit_capability_authorized_human_review',
      ],
    });
    expect(value.billableWork.preWorkDeposit).toMatchObject({
      supported: true,
      completionEvidenceRequired: false,
    });
    expect(value.billableWork.milestoneOrProgress.supported).toBe(false);
    expect(value.billableWork.earnedRevenue).toEqual({
      currentAuthorityAvailable: false,
      invoicePaymentOrCompletionCanDecide: false,
      state: 'earned_revenue_policy_unavailable',
    });
    expect(value.retention).toMatchObject({
      rawQuotedJobMediaDays: 30,
      rawProviderEventDays: 30,
      publicSessionTombstoneDays: 30,
      financialRecordCalendarYears: 7,
      immutableIdempotencyAndAuditCalendarYears: 7,
      legalTaxAccountingProviderSecurityReviewComplete: false,
      holdsSuspendEligibleDeletion: true,
      rawTranscriptCopiedIntoMission27: false,
    });
    for (const review of ['legal', 'provider', 'tax', 'accounting', 'security']) {
      expect(value.professionalReviews[review].accepted).toBe(false);
      expect(value.professionalReviews[review].requiredBefore.length).toBeGreaterThan(0);
    }
    expect(value.performance).toMatchObject({
      maximumJsonRequestBytes: 65536,
      maximumProviderEventBytes: 262144,
      maximumPageSize: 100,
      maximumAccountingExportRecords: 1000,
      maximumAccountingExportMinorUnits: '100000000',
      singleControlAccountingExportRecords: 100,
      singleControlAccountingExportMinorUnits: '10000000',
      maximumSynchronousMutationSeconds: 5,
      maximumProviderSessionMinutes: 30,
      webhookClockToleranceSeconds: 300,
      concurrentWriterPerAggregate: 1,
    });
    expect(value.release).toEqual({
      oneWriter: true,
      sameIndependentWholeHeadAuditor: true,
      maximumAcceptedFindingSeverity: 'none_p0_through_p3',
      oneNormalPullRequest: true,
      oneAutomaticRailwayDeployment: true,
      requiredHttp200Paths: ['/api/health', '/', '/demo/'],
      currentLatestMigration: 259,
      nextSchemaMigration: 260,
      part2BlockedUntilSlice1DReleased: true,
    });
  });

  test('keeps every unsupported result named, unique and value-free', () => {
    const value = policy();
    expect(value.unavailableCodes).toHaveLength(52);
    expect(new Set(value.unavailableCodes).size).toBe(value.unavailableCodes.length);
    expect(value.unavailableCodes).toEqual(expect.arrayContaining([
      'source_authority_unavailable', 'source_currentness_unavailable',
      'extraction_provider_unavailable', 'tax_authority_unavailable',
      'payment_provider_unavailable', 'live_payments_disabled',
      'partial_payments_unsupported', 'multi_invoice_payments_unsupported',
      'check_clearance_authority_unavailable', 'work_handoff_receiver_unavailable',
      'learning_permission_unavailable', 'capacity_source_unavailable',
      'mission32_adapter_unavailable', 'earned_revenue_policy_unavailable',
      'founder_visual_approval_unavailable',
    ]));
    expect(value.unavailableResponse).toEqual({
      available: false,
      value: null,
      requiredFields: ['code', 'category', 'missingEvidence', 'refreshRequired'],
      forbidAmountOrResultDigest: true,
      olderSourceFallback: false,
      demoFallback: false,
    });
  });

  test('preserves the 64-slice sequence and grants no runtime or migration authority', () => {
    const migrationNames = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrationNames.at(-1)).toBe('259_demo_forecast_journey.sql');
    expect(migrationNames.some(name => /^260_/.test(name))).toBe(false);

    const permissions = read('src/auth/permissions.js');
    expect(permissions).not.toContain('customer_financial');
    const runtimeFiles = fs.readdirSync(path.join(ROOT, 'src'));
    expect(runtimeFiles).not.toContain('customerFinancial');

    const roadmap = read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    const ledger = read('docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md');
    expect(roadmap).toContain('fourteen-part structure and the slice order below are frozen');
    expect(roadmap).toContain('| 1 | Mission authority, source inventory, threat model, and acceptance contract | 4 | 1A–1C released; 1D candidate |');
    expect(ledger).toContain('| 1C | Threat model and action-capability/recent-auth/dual-control matrix | Complete');
    expect(ledger).toContain('| 1D | Frozen launch matrix including method-specific offline/check-clearance rules, unsupported states, ledger, and release rules | Candidate');

    const text = document();
    expect(text).toContain('Part 2 may begin only after the same independent auditor accepts this entire exact head with no P0–P3');
    expect(text).toContain('It adds no migration 260.');
    expect(text).toContain('The current application remains unable to perform a Mission 27 action.');
    expect(text).toContain('no capability grant, customer-financial row, provider/accounting connection, external call, live-money action, route, permission, schema, migration, or UI claim');
  });
});
