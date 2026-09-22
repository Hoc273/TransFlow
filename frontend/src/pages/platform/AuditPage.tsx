import { useState } from 'react'
import { usePlatformAuditLogs } from '@/hooks/usePlatform'
import { PlatformPagination } from '@/components/platform/PlatformPagination'

export function AuditPage() {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading, isError } = usePlatformAuditLogs({
    action: action || undefined,
    page,
    size: 20,
  })
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được nhật ký kiểm toán.</div>

  return (
    <div className="space-y-3">
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        Nhật ký kiểm toán chưa triển khai — API đang trả rỗng (read-only MVP theo API_Contract
        §13.1).
      </div>
      <input
        value={action}
        onChange={(e) => {
          setAction(e.target.value)
          setPage(0)
        }}
        placeholder="Lọc theo action..."
        className="input"
      />
      {data.items.length === 0 ? (
        <div className="text-sm text-[var(--color-text-secondary)]">Chưa có bản ghi nào.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Action</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((log, i) => (
              <tr key={log.id ?? i}>
                <td>{log.id ?? '—'}</td>
                <td>{log.action ?? '—'}</td>
                <td>{log.createdAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PlatformPagination
        page={data.page}
        totalPages={data.totalPages}
        totalElements={data.totalItems}
        onPageChange={setPage}
      />
    </div>
  )
}
