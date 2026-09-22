import { usePlatformStatus } from '@/hooks/usePlatform'

export function StatusPage() {
  const { data, isLoading, isError } = usePlatformStatus()
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được trạng thái hạ tầng.</div>

  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--color-text-secondary)]">
        Kiểm tra lúc: {data.checkedAt} · Tổng thể: <strong>{data.overall}</strong>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Dịch vụ</th>
            <th>Trạng thái</th>
            <th>Độ trễ (ms)</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {data.services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <span className={s.status === 'UP' ? 'text-green-600' : 'text-red-600'}>
                  {s.status}
                </span>
              </td>
              <td>{s.latencyMs}</td>
              <td className="text-xs">{s.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
