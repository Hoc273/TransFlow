import { useState } from 'react'
import { usePlatformUsers } from '@/hooks/usePlatform'
import { PlatformPagination } from '@/components/platform/PlatformPagination'

export function UsersPage() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading, isError } = usePlatformUsers({ q: q || undefined, page, size: 20 })
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được danh sách người dùng.</div>

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setPage(0)
        }}
        placeholder="Tìm email / tên..."
        className="input"
      />
      <table className="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Tên</th>
            <th>Admin</th>
            <th>Workspace</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.fullName}</td>
              <td>{u.isPlatformAdmin ? 'Yes' : 'No'}</td>
              <td>{u.workspaceCount}</td>
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
