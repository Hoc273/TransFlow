import { usePlatformOverview } from '@/hooks/usePlatform'

export function OverviewPage() {
  const { data, isLoading, isError } = usePlatformOverview({ topLimit: 10 })
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được tổng quan nền tảng.</div>

  const mockBadge = (
    <span className="phase-badge" title="Backend đang trả số liệu giả — chờ aggregate Phase P2">
      Coming soon
    </span>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <div className="text-sm text-[var(--color-text-secondary)]">Người dùng</div>
          <div className="text-2xl font-semibold">{data.users.total}</div>
          <div className="text-xs">Mới trong khoảng: {data.users.newInRange}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-[var(--color-text-secondary)]">Workspace</div>
          <div className="text-2xl font-semibold">{data.workspaces.total}</div>
          <div className="text-xs">Mới trong khoảng: {data.workspaces.newInRange}</div>
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <div className="flex items-center gap-2 font-medium">
          Jobs theo trạng thái {mockBadge}
        </div>
        <div className="grid gap-2 text-sm md:grid-cols-4">
          {Object.entries(data.jobs).map(([kind, counts]) => (
            <div key={kind} className="rounded border border-[var(--color-border)] p-2">
              <div className="font-semibold">{kind}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                created {counts.created} · completed {counts.completed} · failed {counts.failed}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <div className="flex items-center gap-2 font-medium">Token AI {mockBadge}</div>
        <div className="text-sm">
          input {data.tokens.inputTokens} · output {data.tokens.outputTokens} · total{' '}
          {data.tokens.totalTokens}
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <div className="flex items-center gap-2 font-medium">
          Top workspace {mockBadge}
        </div>
        {data.topWorkspaces.length === 0 ? (
          <div className="text-sm text-[var(--color-text-secondary)]">Chưa có dữ liệu.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Tokens</th>
                <th>Jobs</th>
              </tr>
            </thead>
            <tbody>
              {data.topWorkspaces.map((w) => (
                <tr key={w.workspaceId}>
                  <td>{w.workspaceName}</td>
                  <td>{w.totalTokens}</td>
                  <td>{w.jobCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
