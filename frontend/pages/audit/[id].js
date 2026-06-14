import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getServerSideProps(context) {
  const { id } = context.params;

  try {
    let response = await fetch(`${API_BASE_URL}/api/audit/${id}/summary`);

    if (response.status === 404) {
      response = await fetch(`${API_BASE_URL}/api/audit/portal/${id}/latest/summary`);
    }

    if (!response.ok) {
      return {
        props: {
          audit: null,
          error: `Report ${id} could not be loaded`
        }
      };
    }

    const body = await response.json();

    return {
      props: {
        audit: body.data,
        error: null
      }
    };
  } catch (error) {
    return {
      props: {
        audit: null,
        error: `Report ${id} could not be loaded`
      }
    };
  }
}

function scoreTone(score) {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

export default function AuditReport({ audit, error }) {
  if (error) {
    return (
      <main className="shell">
        <p className="error">{error}</p>
        <p>
          <Link href="/admin">Back to company dashboard</Link>
        </p>
      </main>
    );
  }

  const topIssues = audit.rules.issues.slice(0, 30);

  return (
    <>
      <header className="heroBand">
        <div className="heroInner">
          <div>
            <p className="eyebrow">Audit #{audit.id}</p>
            <h1>Portal health report</h1>
            <div className="heroMeta">
              <span className="heroPill">${audit.waste_estimate.toLocaleString()} waste estimate</span>
              <span className="heroPill">{audit.summary.issue_count} issues</span>
              <span className="heroPill">
                <Link href="/admin">Back to company dashboard</Link>
              </span>
            </div>
          </div>
          <div className={`score ${scoreTone(audit.score)}`}>{audit.score}</div>
        </div>
      </header>

      <main className="shell">
        <section className="metrics">
          <Metric label="Waste estimate" value={`$${audit.waste_estimate.toLocaleString()}`} />
          <Metric label="Pipelines" value={audit.summary.pipeline_count} />
          <Metric label="Workflows" value={audit.summary.workflow_count} />
          <Metric label="Forms" value={audit.summary.form_count} />
          <Metric label="Issues" value={audit.summary.issue_count} />
          <Metric label="User data" value={audit.summary.usage_status} />
        </section>

        <section className="panel">
          <div className="panelHeader">
            <h2>Issues</h2>
            <span>
              Showing {topIssues.length} of {audit.summary.issue_count}
            </span>
          </div>
          <div className="issueList">
            {topIssues.map((issue, index) => (
              <article className="issue" key={`${issue.category}-${index}`}>
                <span className={`severity ${issue.severity}`}>{issue.severity}</span>
                <p>{issue.message}</p>
                <small>{issue.category}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
