const UNUSED_USER_COST = 50;
const INACTIVE_WORKFLOW_COST = 25;
const UNUSED_FORM_COST = 10;

function estimateWaste(snapshot) {
  const unusedUsers =
    snapshot.usage.status === 'available'
      ? Math.max(0, snapshot.usage.total_users - snapshot.usage.active_users)
      : 0;

  const inactiveWorkflows = snapshot.workflows.filter(
    (workflow) => workflow.status === 'inactive'
  ).length;

  const unusedForms = snapshot.forms.filter(
    (form) => form.submissions_available && form.submissions_last_30_days === 0
  ).length;

  return (
    unusedUsers * UNUSED_USER_COST +
    inactiveWorkflows * INACTIVE_WORKFLOW_COST +
    unusedForms * UNUSED_FORM_COST
  );
}

module.exports = {
  estimateWaste
};
