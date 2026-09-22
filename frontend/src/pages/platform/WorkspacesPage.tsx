import { useState } from 'react'
import { usePlatformWorkspaces } from '@/hooks/usePlatform'
import { PlatformPagination } from '@/components/platform/PlatformPagination'

export function WorkspacesPage() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading, isError } = usePlatformWorkspaces({
    q: q || undefined,
    page,
    size: 20,
  })
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được danh sách workspace.</div>

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setPage(0)
        }}
        placeholder="Tìm tên / slug..."
        className="input"
      />
      <table className="table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Slug</th>
            <th>Owner</th>
            <th>Thành viên</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td>{w.slug}</td>
              <td>{w.ownerEmail}</td>
              <td>{w.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PlatformPagination
        page={data.page}
        totalPages={data.totalPages}
        totalElements={data.totalItems}
        onPageChange={setPage}
      />
    </div>
  )
}
