'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  BookOpen, 
  Mic2, 
  Video, 
  RefreshCw, 
  CheckCircle2, 
  Layers, 
  Cpu, 
  Volume2, 
  Play, 
  Clock, 
  FileText,
  ShieldCheck,
  Zap,
  ArrowRight,
  Database
} from 'lucide-react';

const ARCHETYPES = [
  { id: '1', title: 'Thiếu tá Điều tra', desc: 'Bản lĩnh, trọng tình nghĩa, chính trực' },
  { id: '2', title: 'Đại úy An ninh', desc: 'Điềm đạm, kín tiếng, sắc sảo' },
  { id: '3', title: 'Trung tá Biên phòng', desc: 'Mộc mạc, giàu đức hy sinh' },
  { id: '4', title: 'Nữ Đại úy Công an', desc: 'Tự trọng, kiên định' },
  { id: '5', title: 'Đại tá Quân đội', desc: 'Nghiêm nghị, quyết đoán' }
];

const SACRIFICES = [
  'Bán toàn bộ của hồi môn và vàng cưới lo vốn cho chồng lập nghiệp',
  'Tần tảo chăm sóc mẹ chồng tai biến liệt giường suốt 6 năm',
  'Gửi toàn bộ tiền bán đất dưỡng già của mẹ nghèo ở quê cho vợ giữ',
  'Từ chối cơ hội thăng tiến lên tỉnh để ở quê chăm lo bố mẹ chồng'
];

const OPPRESSIONS = [
  'Chồng rước Tiểu tam có bầu về nhà, ép vợ ra đi tay trắng trong đêm mưa',
  'Bị vu oan làm thâm hụt tiền, mẹ chồng ép quỳ lạy từ bỏ quyền nuôi con',
  'Chồng và Tiểu tam cấu kết làm giả chữ ký bán căn nhà 12 tỷ',
  'Con dâu ngược đãi bố chồng thương binh cụt tay, bắt ăn cơm thừa dưới bếp'
];

const SECRETS = [
  'Căn nhà 12 tỷ đứng tên riêng do bố mẹ đẻ mua từ trước ngày cưới',
  'Nhân vật chính giả vờ mù sau tai nạn để thu thập toàn bộ chứng cứ',
  'Vợ cũ thực chất là Tổ trưởng chuyên án đang bí mật điều tra kẻ lừa đảo',
  'Điện thoại bị ném xuống sông được trục vớt, phục hồi tin nhắn tố cáo'
];

const RETRIBUTIONS = [
  'Cảnh sát ập vào phòng công chứng bắt giữ Tiểu tam và Chồng lừa đảo',
  'Mẹ chồng chết lặng khi thấy toàn bộ công an tỉnh cúi chào con dâu là Sếp',
  'Gã nhân tình ôm tiền bỏ trốn để lại món nợ 8 tỷ cho người vợ bội bạc',
  'Kẻ thủ ác bị còng tay ngay trước giờ cử hành đám cưới xa hoa'
];

export default function DashboardPage() {
  const [selectedArch, setSelectedArch] = useState(ARCHETYPES[0]);
  const [selectedSac, setSelectedSac] = useState(SACRIFICES[0]);
  const [selectedOpp, setSelectedOpp] = useState(OPPRESSIONS[0]);
  const [selectedSec, setSelectedSec] = useState(SECRETS[0]);
  const [selectedRet, setSelectedRet] = useState(RETRIBUTIONS[0]);

  const [generatedTitle, setGeneratedTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'matrix' | 'chapters' | 'omnivoice' | 'render'>('matrix');
  const [storyChapters, setStoryChapters] = useState<any[]>([]);
  const [totalWords, setTotalWords] = useState(0);

  useEffect(() => {
    handleRandomize();
  }, []);

  const handleRandomize = () => {
    const arch = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
    const sac = SACRIFICES[Math.floor(Math.random() * SACRIFICES.length)];
    const opp = OPPRESSIONS[Math.floor(Math.random() * OPPRESSIONS.length)];
    const sec = SECRETS[Math.floor(Math.random() * SECRETS.length)];
    const ret = RETRIBUTIONS[Math.floor(Math.random() * RETRIBUTIONS.length)];

    setSelectedArch(arch);
    setSelectedSac(sac);
    setSelectedOpp(opp);
    setSelectedSec(sec);
    setSelectedRet(ret);

    const title = `${arch.title} Giả Mù Sau Tai Nạn – Chồng và Tiểu Tam C.hết L.ặng Thấy Cảnh Sát Gọi Vợ Là Sếp | Sâm Kể Chuyện`;
    setGeneratedTitle(title);
  };

  const handleBuildStory = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const demoChapters = [
        { num: 1, act: 'Hồi 1', title: 'Bát cơm nguội và lời thề ngày nghèo khó', words: 2650, speaker: 'bac_sam & nhan_vat' },
        { num: 2, act: 'Hồi 1', title: 'Mái nhà xây bằng những nhọc nhằn', words: 2780, speaker: 'nhan_vat' },
        { num: 3, act: 'Hồi 2', title: 'Những cuộc gọi đêm và mật khẩu đổi thay', words: 2840, speaker: 'nhan_vat' },
        { num: 4, act: 'Hồi 2', title: 'Khi người thứ ba bước qua ngưỡng cửa', words: 2910, speaker: 'nhan_vat & tieu_tam' },
        { num: 5, act: 'Hồi 3', title: 'Biến cố bất ngờ và lòng người lộ diện', words: 2540, speaker: 'nhan_vat & me_chong' },
        { num: 6, act: 'Hồi 3', title: 'Thu thập từng mảnh chứng cứ trong bóng tối', words: 2690, speaker: 'nhan_vat' },
        { num: 7, act: 'Hồi 4', title: 'Bản hợp đồng chuyển nhượng 12 tỷ', words: 3100, speaker: 'nhan_vat & me_chong' },
        { num: 8, act: 'Hồi 4', title: 'Cầu vai sắc phục và sự chết lặng', words: 3250, speaker: 'nhan_vat & can_bo' },
        { num: 9, act: 'Hồi 5', title: 'Cái giá đắt của sự vong ân', words: 2420, speaker: 'nhan_vat' },
        { num: 10, act: 'Hồi 5', title: 'Bát phở ấm bên đường và ngày trở về', words: 2180, speaker: 'bac_sam & nhan_vat' }
      ];
      setStoryChapters(demoChapters);
      const total = demoChapters.reduce((acc, curr) => acc + curr.words, 0);
      setTotalWords(total);
      setIsGenerating(false);
      setActiveTab('chapters');
    }, 800);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Mic2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              auto_YT <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">web_vn</span>
            </h1>
            <p className="text-xs text-slate-400">Sâm Kể Chuyện Audio Drama Engine (2.5 Hours Long-form)</p>
          </div>
        </div>

        {/* Runtime Status Badges */}
        <div className="flex items-center space-x-4 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Database className="w-3.5 h-3.5" />
            <span>Postgres: 5438 (auto_yt_vn)</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
            <Cpu className="w-3.5 h-3.5" />
            <span>OmniVoice: Ready</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <Clock className="w-3.5 h-3.5" />
            <span>Port: 3005</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 space-x-2">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'matrix' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            1. Ma trận Topic & Blueprint
          </button>
          <button
            onClick={() => setActiveTab('chapters')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'chapters' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            2. Pipeline 10 Chương ({totalWords.toLocaleString()} từ)
          </button>
          <button
            onClick={() => setActiveTab('omnivoice')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'omnivoice' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            3. OmniVoice Multi-Speaker
          </button>
          <button
            onClick={() => setActiveTab('render')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'render' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Video className="w-4 h-4" />
            4. Video Render (GPU NVENC)
          </button>
        </div>

        {/* Tab 1: Topic Matrix */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            {/* Generated Title Banner */}
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Tiêu đề Kịch tính Đã Tối ưu Clickbait (CTR & Evasion)
                </span>
                <button
                  onClick={handleRandomize}
                  className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Xáo trộn Ma trận
                </button>
              </div>
              <textarea
                value={generatedTitle}
                onChange={(e) => setGeneratedTitle(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-xl p-3.5 text-base font-semibold text-amber-200 focus:outline-none focus:border-amber-500 resize-none"
                rows={2}
              />
            </div>

            {/* Matrix Variables Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    1. Thân phận & Phẩm chất Nhân vật chính
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ARCHETYPES.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedArch(a)}
                      className={`text-left p-3 rounded-lg border text-xs transition ${
                        selectedArch.id === a.id
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-slate-200">{a.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{a.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <HeartHandshake className="w-4 h-4 text-pink-400" />
                  2. Sự hy sinh ban đầu (Thiết lập lòng trắc ẩn)
                </label>
                <div className="space-y-2">
                  {SACRIFICES.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedSac(s)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition ${
                        selectedSac === s
                          ? 'bg-pink-950/40 border-pink-500 text-pink-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-red-400" />
                  3. Hành vi áp bức & Bạc bẽo (Đẩy xung đột đỉnh điểm)
                </label>
                <div className="space-y-2">
                  {OPPRESSIONS.map((o, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedOpp(o)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition ${
                        selectedOpp === o
                          ? 'bg-red-950/40 border-red-500 text-red-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-400" />
                  4. Bí mật & Cú Lật kèo (Catharsis / Thỏa mãn)
                </label>
                <div className="space-y-2">
                  {RETRIBUTIONS.map((r, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedRet(r)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition ${
                        selectedRet === r
                          ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="flex justify-end">
              <button
                onClick={handleBuildStory}
                disabled={isGenerating}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold px-6 py-3.5 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Khởi tạo Kịch bản 10 Chương (2.5 Giờ)
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Chapters Breakdown */}
        {activeTab === 'chapters' && (
          <div className="space-y-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">{generatedTitle}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tổng dung lượng: <span className="text-amber-400 font-semibold">{totalWords.toLocaleString()} từ</span> (~2 giờ 35 phút audio) • 10 Chương hoàn chỉnh
                </p>
              </div>
              <button
                onClick={() => setActiveTab('omnivoice')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
              >
                Chuyển sang TTS OmniVoice <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {storyChapters.map((ch) => (
                <div key={ch.num} className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 space-y-2 hover:border-slate-700 transition">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-amber-400 font-mono font-semibold">
                      {ch.act} • Chương {ch.num}
                    </span>
                    <span className="text-xs text-slate-400">{ch.words} từ</span>
                  </div>
                  <h4 className="font-semibold text-slate-200 text-sm">{ch.title}</h4>
                  <div className="text-xs text-slate-400 flex items-center gap-2 pt-1 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-500">Giọng đọc:</span>
                    <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-mono text-[10px]">
                      {ch.speaker}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: OmniVoice */}
        {activeTab === 'omnivoice' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-indigo-400" />
                Cấu hình Giọng đọc OmniVoice (Multi-Speaker Profiles)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Tự động chia tách câu thoại và gán giọng đọc tương ứng theo tag [SPEAKER:xxx]
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-amber-300">1. Giọng Bác Sâm (Host / Dẫn chuyện)</div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">bac_sam</span>
                </div>
                <p className="text-xs text-slate-400">Giọng nam miền Bắc trầm ấm, tốc độ 0.95x, chiêm nghiệm đời sống</p>
                <div className="text-xs bg-slate-900 p-2.5 rounded text-slate-300 font-mono">
                  data/voices/bac_sam_ref.wav (Đã sẵn sàng kết nối)
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-indigo-300">2. Giọng Nhân vật chính (Tự sự)</div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">nhan_vat_chinh</span>
                </div>
                <p className="text-xs text-slate-400">Giọng nam/nữ trẻ hơn, chân chất, thể hiện sự hy sinh và đau đớn</p>
                <div className="text-xs bg-slate-900 p-2.5 rounded text-slate-300 font-mono">
                  data/voices/nhan_vat_ref.wav (Đã sẵn sàng kết nối)
                </div>
              </div>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-xl p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-indigo-200">Trạng thái OmniVoice Local Server</div>
                <div className="text-xs text-indigo-300/80">Endpoint: http://127.0.0.1:8000 (Sẽ kết nối khi bạn khởi chạy model clone)</div>
              </div>
              <button 
                onClick={() => alert("OmniVoice Client đã sẵn sàng. Khi bạn khởi động server clone giọng, pipeline sẽ tự động bắt luồng synthesis!")}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition"
              >
                Kiểm tra Kết nối
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: Render */}
        {activeTab === 'render' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Video className="w-5 h-5 text-amber-400" />
                Trung tâm Render Video GPU NVENC (1080p Master)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Tự động ghép Master Audio 2.5h + Ảnh nền chất lượng cao + Waveform + Phụ đề SRT
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="text-xs text-slate-400">Độ phân giải</div>
                <div className="text-base font-bold text-white">Full HD 1080p (60fps)</div>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="text-xs text-slate-400">Bộ giải mã tăng tốc</div>
                <div className="text-base font-bold text-emerald-400">NVIDIA NVENC (p4 tune:hq)</div>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="text-xs text-slate-400">Thời gian render ước tính</div>
                <div className="text-base font-bold text-amber-400">3 ~ 5 Phút (cho 2.5 giờ audio)</div>
              </div>
            </div>

            <div className="flex justify-end">
              <button 
                onClick={() => alert("Hệ thống Render GPU đã sẵn sàng nhận Audio Master!")}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Bắt đầu Render Video Master
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function HeartHandshake(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
      <path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08v0c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.18 0l1.9 1.9c.87.87 2.27.87 3.14 0v0a2.17 2.17 0 0 0 0-3.08L19.5 5"/>
    </svg>
  );
}
