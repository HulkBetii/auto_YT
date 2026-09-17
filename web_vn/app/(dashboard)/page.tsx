'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  BookOpen, 
  RefreshCw, 
  CheckCircle2, 
  Layers, 
  Cpu, 
  Clock, 
  FileText,
  ShieldCheck,
  Zap,
  ArrowRight,
  Database,
  Copy,
  Check,
  AlertCircle,
  Play
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
  const [activeTab, setActiveTab] = useState<'matrix' | 'stepper' | 'fullscript' | 'seo'>('matrix');
  const [currentStoryId, setCurrentStoryId] = useState<number | null>(null);
  
  const [turnData, setTurnData] = useState<{
    turn1_blueprint: string | null;
    turn2_chapters_1_4: string | null;
    turn3_chapters_5_7: string | null;
    turn4_chapters_8_10: string | null;
    turn5_metadata_seo: string | null;
    full_script: string | null;
  }>({
    turn1_blueprint: null,
    turn2_chapters_1_4: null,
    turn3_chapters_5_7: null,
    turn4_chapters_8_10: null,
    turn5_metadata_seo: null,
    full_script: null,
  });

  const [totalWords, setTotalWords] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    handleRandomize();
  }, []);

  // Poll generation progress if storyId active
  useEffect(() => {
    if (!currentStoryId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/generate?storyId=${currentStoryId}`);
        const data = await res.json();
        if (data.success && data.turns) {
          setTurnData(data.turns);
          setTotalWords(data.totalWords || 0);
          if (data.isCompleted) {
            setIsGenerating(false);
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [currentStoryId]);

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

    const title = `${arch.title} Giả Mù Sau T.ai N.ạn – Chồng và Tiểu Tam C.hết L.ặng Thấy Cảnh Sát Gọi Vợ Là Sếp | Sâm Kể Chuyện`;
    setGeneratedTitle(title);
  };

  const handleStartGeneration = async () => {
    setIsGenerating(true);
    setActiveTab('stepper');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generatedTitle,
          topicMatrix: {
            archetype: selectedArch.title,
            sacrifice: selectedSac,
            oppression: selectedOpp,
            plot_secret: selectedSec,
            retribution: selectedRet,
            moral: "Giá trị của người phụ nữ không nằm ở sự cam chịu, mà là dũng cảm sống vì danh dự và sự thật."
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentStoryId(data.storyId);
      } else {
        alert("Lỗi khởi chạy: " + data.error);
        setIsGenerating(false);
      }
    } catch (err: any) {
      alert("Lỗi kết nối API: " + err.message);
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              auto_YT <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">Phase 1: Story Writer</span>
            </h1>
            <p className="text-xs text-slate-400">Playwright ChatGPT Pipeline (PROFILE_GPT_1) • Sâm Kể Chuyện Style</p>
          </div>
        </div>

        {/* Runtime Status Badges */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Database className="w-3.5 h-3.5" />
            <span>DB: 5438 (auto_yt_vn)</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
            <Cpu className="w-3.5 h-3.5" />
            <span>Playwright: PROFILE_GPT_1</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
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
            onClick={() => setActiveTab('stepper')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'stepper' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin text-amber-400' : ''}`} />
            2. Tiến trình 5-Turn Playwright
          </button>
          <button
            onClick={() => setActiveTab('fullscript')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'fullscript' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            3. Kịch bản Hoàn chỉnh ({totalWords.toLocaleString()} từ)
          </button>
          <button
            onClick={() => setActiveTab('seo')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'seo' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            4. Trọn bộ Metadata SEO & Thumbnail
          </button>
        </div>

        {/* Tab 1: Topic Matrix */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Tiêu đề Kịch tính Đã Tối ưu Lách Kiểm duyệt
                </span>
                <button
                  onClick={handleRandomize}
                  className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition cursor-pointer"
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
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  1. Thân phận & Phẩm chất Nhân vật chính
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ARCHETYPES.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedArch(a)}
                      className={`text-left p-3 rounded-lg border text-xs transition cursor-pointer ${
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
                  2. Sự hy sinh ban đầu (Tạo lòng trắc ẩn)
                </label>
                <div className="space-y-2">
                  {SACRIFICES.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedSac(s)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition cursor-pointer ${
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
                  3. Hành vi áp bức & Bạc bẽo (Xung đột dâng cao)
                </label>
                <div className="space-y-2">
                  {OPPRESSIONS.map((o, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedOpp(o)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition cursor-pointer ${
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
                  4. Bí mật & Cú Lật kèo (Thỏa mãn công lý)
                </label>
                <div className="space-y-2">
                  {RETRIBUTIONS.map((r, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedRet(r)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition cursor-pointer ${
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
                onClick={handleStartGeneration}
                disabled={isGenerating}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold px-7 py-3.5 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Khởi chạy Playwright ChatGPT Sinh Kịch Bản (5 Turns)
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Stepper Progress */}
        {activeTab === 'stepper' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  Tiến trình Tự động hóa 5 Lượt (Playwright ChatGPT Session)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Đang chạy trên profile <span className="text-indigo-400 font-mono">PROFILE_GPT_1</span> với context liên tục
                </p>
              </div>
              <div className="text-xs font-mono text-amber-400 px-3 py-1 rounded bg-amber-500/10 border border-amber-500/30">
                {totalWords.toLocaleString()} từ được tạo
              </div>
            </div>

            {/* 5 Turn Steps */}
            <div className="space-y-4">
              {[
                { turn: 1, name: 'Turn 1: Master Blueprint & Dàn ý 10 Chương', data: turnData.turn1_blueprint },
                { turn: 2, name: 'Turn 2: Hồi 1 & Hồi 2 (Chương 1 - 4: ~9.000 từ)', data: turnData.turn2_chapters_1_4 },
                { turn: 3, name: 'Turn 3: Hồi 3 (Chương 5 - 7: ~9.000 từ - Biến cố & Âm mưu)', data: turnData.turn3_chapters_5_7 },
                { turn: 4, name: 'Turn 4: Hồi 4 & 5 (Chương 8 - 10: ~10.000 từ - Lật kèo & Outro)', data: turnData.turn4_chapters_8_10 },
                { turn: 5, name: 'Turn 5: Trọn bộ Metadata SEO & Prompt Thumbnail', data: turnData.turn5_metadata_seo },
              ].map((step) => (
                <div 
                  key={step.turn}
                  className={`p-4 rounded-xl border transition ${
                    step.data 
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-200'
                      : isGenerating 
                        ? 'bg-slate-950/40 border-slate-800 text-slate-400' 
                        : 'bg-slate-950/20 border-slate-800/60 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {step.data ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : isGenerating ? (
                        <RefreshCw className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                      ) : (
                        <Clock className="w-5 h-5 text-slate-600 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-sm">{step.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {step.data ? `Đã hoàn thành (${step.data.length.toLocaleString()} ký tự)` : 'Đang chờ xử lý...'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {turnData.full_script && (
              <div className="flex justify-end pt-4 border-t border-slate-800">
                <button
                  onClick={() => setActiveTab('fullscript')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition cursor-pointer"
                >
                  Đọc Duyệt Kịch Bản Hoàn Chỉnh ({totalWords.toLocaleString()} từ) <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Full Script Reader */}
        {activeTab === 'fullscript' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-white text-base">{generatedTitle}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Độ dài: <span className="text-amber-400 font-semibold">{totalWords.toLocaleString()} từ</span> (~{Math.round(totalWords / 135 / 60 * 10) / 10} giờ đọc audio)
                </p>
              </div>
              <button
                onClick={() => copyToClipboard(turnData.full_script || '')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Đã sao chép' : 'Sao chép toàn bộ kịch bản'}
              </button>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 max-h-[600px] overflow-y-auto space-y-4 text-sm text-slate-300 leading-relaxed font-sans whitespace-pre-wrap selection:bg-amber-500/20">
              {turnData.full_script || "Chưa có kịch bản. Hãy quay lại Tab 1 và bấm khởi chạy."}
            </div>
          </div>
        )}

        {/* Tab 4: SEO Metadata */}
        {activeTab === 'seo' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-white text-base">Bộ Metadata SEO & Prompt Thumbnail YouTube</h3>
                <p className="text-xs text-slate-400 mt-1">Đã tối ưu hóa tiêu đề lách kiểm duyệt, mô tả 6 phần kèm Disclaimer và danh sách 20 thẻ tags</p>
              </div>
              <button
                onClick={() => copyToClipboard(turnData.turn5_metadata_seo || '')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Đã sao chép' : 'Sao chép Metadata'}
              </button>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 max-h-[600px] overflow-y-auto text-sm text-slate-300 whitespace-pre-wrap font-mono selection:bg-amber-500/20">
              {turnData.turn5_metadata_seo || "Chưa có dữ liệu Metadata SEO."}
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
