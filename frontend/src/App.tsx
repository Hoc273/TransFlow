export default function App() {
  return (
    <div className="min-h-screen bg-[#09090a] text-[#f4f4f5] flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-[#0f1115] border border-[#272c35] rounded-2xl p-8 shadow-2xl text-center">
        <div className="inline-block px-4 py-1.5 rounded-full bg-[rgba(113,79,252,0.15)] border border-[rgba(113,79,252,0.35)] text-[#a78bff] text-xs font-bold uppercase tracking-wider mb-4">
          TransFlow UI 2.0 • Ready to Code
        </div>
        
        <h1 className="text-3xl font-extrabold tracking-tight mb-3 bg-gradient-to-r from-white via-[#f0f2fa] to-[#a78bff] bg-clip-text text-transparent">
          Môi Trường Frontend Đã Sẵn Sàng!
        </h1>
        
        <p className="text-[#a1a1aa] text-sm leading-relaxed mb-6">
          Toàn bộ cấu hình hệ thống (React 19, Vite 8, Tailwind CSS v4, TypeScript 6) và cây thư mục chuẩn đã được khởi tạo thành công tại:
          <br />
          <code className="text-[#c4b5fd] bg-[#16191d] px-2.5 py-1 rounded border border-[#272c35] text-xs inline-block mt-2">
            D:\Project\Project_Kada\TransFlow\frontend
          </code>
        </p>

        <div className="grid grid-cols-2 gap-3 text-left mb-6">
          <div className="p-3 bg-[#16191d] border border-[#1a1e23] rounded-lg">
            <div className="text-xs font-bold text-[#a78bff] mb-1">Dev 1 (Lead / Senior)</div>
            <div className="text-xs text-[#71717a]">Nhánh gốc: <span className="text-white">feature/frontend</span></div>
            <div className="text-xs text-[#71717a]">Mục tiêu: Core Shell, Auth, CAT Editor</div>
          </div>
          <div className="p-3 bg-[#16191d] border border-[#1a1e23] rounded-lg">
            <div className="text-xs font-bold text-[#60a5fa] mb-1">Dev 2 (Core / Mid-Senior)</div>
            <div className="text-xs text-[#71717a]">Nhánh gốc: <span className="text-white">feature/frontend</span></div>
            <div className="text-xs text-[#71717a]">Mục tiêu: UI Atoms, Batches, Media Studio</div>
          </div>
        </div>

        <div className="text-xs text-[#71717a] border-t border-[#1a1e23] pt-4">
          Tham khảo file kế hoạch đẩy code chi tiết tại: <br />
          <span className="text-[#f4f4f5] font-mono">C:\Users\nguye\Downloads\KE_HOACH_FRONTEND_1_TUAN_RUOI_TRANSFLOW.md</span>
        </div>
      </div>
    </div>
  )
}
