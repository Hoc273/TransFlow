-- RENDER held by unresolved BLOCK_RENDER QA issues notifies the job owner (JOB_QA_BLOCKED).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'JOB_COMPLETED', 'JOB_FAILED', 'JOB_NEEDS_RERUN', 'JOB_QA_BLOCKED',
    'BATCH_COMPLETED', 'BATCH_PARTIALLY_FAILED', 'BATCH_FAILED'
));
