'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  Volume2, 
  Play, 
  Pause, 
  Headphones, 
  Radio, 
  Sliders, 
  Users, 
  Download, 
  Music, 
  Award, 
  UserCheck, 
  Flame,
  Image as ImageIcon,
  Wand2,
  Palette,
  Eye,
  Type,
  AlertTriangle,
  XCircle,
  Activity,
  SlidersHorizontal,
  HelpCircle,
  CheckSquare
} from 'lucide-react';

import matrixPresetsData from '@/data/topic_matrix_presets.json';

interface Archetype {
  id: string;
  title: string;
  desc: string;
}

interface ConflictCluster {
  id: string;
  name: string;
  badge: string;
  desc: string;
  default_pronoun: string;
  victim_role_name: string;
  antagonist_1_name: string;
  antagonist_2_name: string;
  voice_preset: {
    host: string;
    victim: string;
    antagonist_1: string;
    antagonist_2: string;
    justice: string;
  };
  archetypes: Archetype[];
  sacrifices: string[];
  oppressions: string[];
  plot_secrets: string[];
  retributions: string[];
  morals: string[];
  title_templates: string[];
}

interface VoiceCard {
  id: string;
  name: string;
  role: string;
  model: string;
  desc: string;
  file: string;
  style: string;
  quality: string;
}

const CLUSTERS: ConflictCluster[] = matrixPresetsData.clusters as ConflictCluster[];

const ALL_VOICE_CARDS: VoiceCard[] = [
  {
    id: 'bac_sam',
    name: 'Bác Sâm',
    role: 'Người Dẫn Chuyện (Master Narrator)',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Thanh Bình)',
    desc: 'Giọng nam trung niên miền Bắc, chiêm nghiệm, trầm ấm, nhịp điệu từ tốn, thấu cảm sự đời.',
    file: 'test_voices/test_bac_sam.wav',
    style: 'Kể chuyện',
    quality: '48 kHz'
  },
  {
    id: 'nhan_vat_chinh',
    name: 'Nữ Chính (Minh Hà)',
    role: 'Nữ Chính Khổ Hạnh & Kiên Cường',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Ngọc Linh)',
    desc: 'Giọng nữ chuẩn Hà Nội, nghẹn ngào, nén đau thương, dứt khoát và đanh thép khi lật màn.',
    file: 'test_voices/test_nhan_vat_chinh.wav',
    style: 'Kể chuyện / Cảm xúc',
    quality: '48 kHz'
  },
  {
    id: 'bo_chong',
    name: 'Bố Chồng / Cựu Binh Già',
    role: 'Nam Cao Tuổi Khắc Khổ & Bản Lĩnh',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Thanh Bình / Ref Clone)',
    desc: 'Giọng nam lớn tuổi miền Bắc, trầm đục, từng trải, nén nỗi xót xa nhưng uy nghiêm đĩnh đạc.',
    file: 'test_voices/test_bac_sam.wav',
    style: 'Kể chuyện / Xúc động',
    quality: '48 kHz'
  },
  {
    id: 'me_gia',
    name: 'Mẹ Già Quê Nghèo',
    role: 'Nữ Cao Tuổi Tần Tảo & Nghẹn Ngào',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Mai Anh)',
    desc: 'Giọng nữ lớn tuổi miền quê, khắc khổ, rung rẩy nghẹn ngào, giàu tình mẫu tử bao la.',
    file: 'samples/me_chong.wav',
    style: 'Tự sự / Nghẹn ngào',
    quality: '48 kHz'
  },
  {
    id: 'nguoi_chong',
    name: 'Người Chồng Cựu Binh',
    role: 'Nam Trung Niên Cương Trực & Phong Trần',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Phạm Tuyên)',
    desc: 'Giọng nam trung niên miền Bắc, dứt khoát, phong trần, đậm chất kỷ luật người lính.',
    file: 'samples/nguoi_chong.mp3',
    style: 'Tự sự / Phong trần',
    quality: '48 kHz'
  },
  {
    id: 'me_chong',
    name: 'Mẹ Chồng Cay Nghiệt',
    role: 'Mẹ Chồng / Mẹ Đẻ Áp Bức',
    model: 'VieNeu Zero-Shot Refined 48kHz (Mai Anh)',
    desc: 'Giọng nữ lớn tuổi, the thé, sắc lẹm, chì chiết, luôn trịch thượng chèn ép.',
    file: 'test_voices/test_me_chong.wav',
    style: 'Tự nhiên / Đanh thép',
    quality: '48 kHz'
  },
  {
    id: 'tieu_tam',
    name: 'Tiểu Tam / Con Dâu Hỗn / Vợ Bội Bạc',
    role: 'Nữ Trẻ Sắc Lẹm & Trơ Trẽn',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Trúc Ly)',
    desc: 'Giọng nữ trẻ lả lơi, nũng nịu, châm chọc mỉa mai, lộ rõ bản chất tham lam trơ trẽn.',
    file: 'test_voices/test_tieu_tam.wav',
    style: 'Tự nhiên / Lảnh lót',
    quality: '48 kHz'
  },
  {
    id: 'chong_boi_bac',
    name: 'Chồng Bội Bạc / Kẻ Trọc Phú / Con Bất Hiếu',
    role: 'Nam Vô Ơn & Lạnh Lùng',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Phạm Tuyên)',
    desc: 'Giọng nam trẻ/trung niên gia trưởng, lạnh lùng, quát tháo tàn nhẫn, hèn nhát khi đối diện pháp luật.',
    file: 'test_voices/test_chong_boi_bac.wav',
    style: 'Tự nhiên / Lạnh lùng',
    quality: '48 kHz'
  },
  {
    id: 'can_bo',
    name: 'Đại Diện Công Lý / Đồng Đội',
    role: 'Đại Diện Pháp Luật & Công Lý',
    model: 'VieNeu-TTS v3 Turbo 48kHz (Thanh Bình)',
    desc: 'Giọng nam dứt khoát, đanh thép, thể hiện sự trang nghiêm của pháp luật và công lý.',
    file: 'test_voices/test_bac_sam.wav',
    style: 'Trang nghiêm / Đanh thép',
    quality: '48 kHz'
  }
];

export default function DashboardPage() {
  const [selectedClusterIndex, setSelectedClusterIndex] = useState<number>(0);
  const currentCluster = CLUSTERS[selectedClusterIndex] || CLUSTERS[0];

  const [selectedArch, setSelectedArch] = useState<Archetype>(currentCluster.archetypes[0]);
  const [selectedSac, setSelectedSac] = useState<string>(currentCluster.sacrifices[0]);
  const [selectedOpp, setSelectedOpp] = useState<string>(currentCluster.oppressions[0]);
  const [selectedSec, setSelectedSec] = useState<string>(currentCluster.plot_secrets[0]);
  const [selectedRet, setSelectedRet] = useState<string>(currentCluster.retributions[0]);
  const [selectedMoral, setSelectedMoral] = useState<string>(currentCluster.morals[0]);

  const [generatedTitle, setGeneratedTitle] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'matrix' | 'stepper' | 'fullscript' | 'seo' | 'audio' | 'thumbnail'>('matrix');
  const [currentStoryId, setCurrentStoryId] = useState<string | number>('test_01');
  
  const [turnData, setTurnData] = useState<{
    turn1_blueprint: string | null;
    turn2_chapters_1_3: string | null;
    turn3_chapters_4_6: string | null;
    turn4_chapters_7_9: string | null;
    turn5_chapter_10_outro: string | null;
    turn6_metadata_seo: string | null;
    full_script: string | null;
  }>({
    turn1_blueprint: null,
    turn2_chapters_1_3: null,
    turn3_chapters_4_6: null,
    turn4_chapters_7_9: null,
    turn5_chapter_10_outro: null,
    turn6_metadata_seo: null,
    full_script: null,
  });

  const [totalWords, setTotalWords] = useState(0);
  const [copied, setCopied] = useState(false);

  // Audio Tab State
  const [selectedEngine, setSelectedEngine] = useState<'vieneu' | 'edge_tts' | 'omnivoice'>('vieneu');
  const [audioStatus, setAudioStatus] = useState<{
    totalChunks: number;
    generatedChunks: number;
    hasFullAudio: boolean;
    hasPreviewAudio: boolean;
  }>({
    totalChunks: 0,
    generatedChunks: 0,
    hasFullAudio: false,
    hasPreviewAudio: false
  });
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<string>('all');
  const [selectedLimit, setSelectedLimit] = useState<string>('all');
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Thumbnail AI Studio State
  const [thumbnailStatus, setThumbnailStatus] = useState<{
    hasRawImage: boolean;
    hasFinalThumbnail: boolean;
    prompt: string;
    suggestedTitles: string[];
    rawImageUrl: string | null;
    finalThumbnailUrl: string | null;
    pipelineData?: any;
  }>({
    hasRawImage: false,
    hasFinalThumbnail: false,
    prompt: '',
    suggestedTitles: [],
    rawImageUrl: null,
    finalThumbnailUrl: null,
    pipelineData: null,
  });
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [selectedThumbTitle, setSelectedThumbTitle] = useState<string>('');
  const [customThumbTitle, setCustomThumbTitle] = useState<string>('');
  const [selectedBadge, setSelectedBadge] = useState<string>('🎙️ SÂM KỂ CHUYỆN');
  const [selectedConceptId, setSelectedConceptId] = useState<string>('A');
  const [selectedHostEmotion, setSelectedHostEmotion] = useState<string>('serious');
  const [selectedHostPos, setSelectedHostPos] = useState<string>('left');
  const [selectedProvider, setSelectedProvider] = useState<string>('playwright_chatgpt');
  const [selectedHookCategory, setSelectedHookCategory] = useState<string>('all');
  const [isExecutingPipeline, setIsExecutingPipeline] = useState(false);
  const [pipelineActionMsg, setPipelineActionMsg] = useState<string>('');
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [isCompositing, setIsCompositing] = useState(false);

  // Initialize cluster & thumbnail
  useEffect(() => {
    applyCluster(0);
    fetchAudioStatus();
    fetchThumbnailStatus('story_bo_chong_drama_04');
  }, []);

  const applyCluster = (index: number) => {
    setSelectedClusterIndex(index);
    const cluster = CLUSTERS[index] || CLUSTERS[0];
    const arch = cluster.archetypes[0];
    const sac = cluster.sacrifices[0];
    const opp = cluster.oppressions[0];
    const sec = cluster.plot_secrets[0];
    const ret = cluster.retributions[0];
    const moral = cluster.morals[0];
    const title = cluster.title_templates[Math.floor(Math.random() * cluster.title_templates.length)];

    setSelectedArch(arch);
    setSelectedSac(sac);
    setSelectedOpp(opp);
    setSelectedSec(sec);
    setSelectedRet(ret);
    setSelectedMoral(moral);
    setGeneratedTitle(title);
  };

  const handleRandomizeWithinCluster = () => {
    const cluster = currentCluster;
    const arch = cluster.archetypes[Math.floor(Math.random() * cluster.archetypes.length)];
    const sac = cluster.sacrifices[Math.floor(Math.random() * cluster.sacrifices.length)];
    const opp = cluster.oppressions[Math.floor(Math.random() * cluster.oppressions.length)];
    const sec = cluster.plot_secrets[Math.floor(Math.random() * cluster.plot_secrets.length)];
    const ret = cluster.retributions[Math.floor(Math.random() * cluster.retributions.length)];
    const moral = cluster.morals[Math.floor(Math.random() * cluster.morals.length)];
    const title = cluster.title_templates[Math.floor(Math.random() * cluster.title_templates.length)];

    setSelectedArch(arch);
    setSelectedSac(sac);
    setSelectedOpp(opp);
    setSelectedSec(sec);
    setSelectedRet(ret);
    setSelectedMoral(moral);
    setGeneratedTitle(title);
  };

  const handleRandomizeAllClusters = () => {
    const nextIdx = Math.floor(Math.random() * CLUSTERS.length);
    applyCluster(nextIdx);
  };

  // Poll generation progress if storyId active
  useEffect(() => {
    if (!currentStoryId || typeof currentStoryId !== 'number') return;

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

  // Poll Audio Synthesis status
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === 'audio' || isSynthesizing) {
        fetchAudioStatus();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, isSynthesizing, currentStoryId]);

  const fetchAudioStatus = async () => {
    try {
      const res = await fetch(`/api/audio?storyId=${currentStoryId}`);
      const data = await res.json();
      if (data.success) {
        setAudioStatus({
          totalChunks: data.totalChunks,
          generatedChunks: data.generatedChunks,
          hasFullAudio: data.hasFullAudio,
          hasPreviewAudio: data.hasPreviewAudio
        });
        if (data.totalChunks > 0 && data.generatedChunks >= data.totalChunks) {
          setIsSynthesizing(false);
        }
      }
    } catch (e) {
      console.error("Error fetching audio status:", e);
    }
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
            cluster_id: currentCluster.id,
            cluster_name: currentCluster.name,
            default_pronoun: currentCluster.default_pronoun,
            victim_role: currentCluster.voice_preset.victim,
            victim_role_name: currentCluster.victim_role_name,
            antagonist_1_role: currentCluster.voice_preset.antagonist_1,
            antagonist_1_name: currentCluster.antagonist_1_name,
            antagonist_2_role: currentCluster.voice_preset.antagonist_2,
            antagonist_2_name: currentCluster.antagonist_2_name,
            justice_role: currentCluster.voice_preset.justice,
            justice_name: "Đại diện công lý / Đồng đội cũ",
            archetype: selectedArch.title,
            sacrifice: selectedSac,
            oppression: selectedOpp,
            plot_secret: selectedSec,
            retribution: selectedRet,
            moral: selectedMoral
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

  const handleStartAudioSynthesis = async () => {
    setIsSynthesizing(true);
    try {
      const res = await fetch('/api/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: currentStoryId,
          engine: selectedEngine,
          chapter: selectedChapter !== 'all' ? parseInt(selectedChapter) : undefined,
          limit: selectedLimit !== 'all' ? parseInt(selectedLimit) : undefined
        })
      });
      const data = await res.json();
      if (!data.success) {
        alert("Lỗi khởi chạy synthesis: " + data.error);
        setIsSynthesizing(false);
      }
    } catch (e: any) {
      alert("Lỗi kết nối API: " + e.message);
      setIsSynthesizing(false);
    }
  };

  const playVoiceSample = (voiceId: string, filePath: string) => {
    if (playingVoice === voiceId) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingVoice(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = `/api/audio?file=${encodeURIComponent(filePath)}`;
      audioPlayerRef.current.play();
      setPlayingVoice(voiceId);
      audioPlayerRef.current.onended = () => setPlayingVoice(null);
    }
  };

  const fetchThumbnailStatus = async (storyId: string | number = currentStoryId) => {
    try {
      const res = await fetch(`/api/thumbnail?storyId=${storyId}`);
      const data = await res.json();
      if (data.success) {
        setThumbnailStatus(data);
        if (data.pipelineData?.stage6_prompt?.final_prompt) {
          setCustomPrompt(data.pipelineData.stage6_prompt.final_prompt);
        } else if (data.prompt) {
          setCustomPrompt((prev) => prev || data.prompt);
        }
        if (data.pipelineData?.stage5_selection?.recommended_title_text) {
          setSelectedThumbTitle((prev) => prev || data.pipelineData.stage5_selection.recommended_title_text);
        } else if (data.suggestedTitles?.length > 0) {
          setSelectedThumbTitle((prev) => prev || data.suggestedTitles[0]);
        }
        if (data.pipelineData?.stage5_selection?.recommended_concept_id) {
          setSelectedConceptId(data.pipelineData.stage5_selection.recommended_concept_id);
        }
        if (data.pipelineData?.stage5_selection?.host_emotion) {
          setSelectedHostEmotion(data.pipelineData.stage5_selection.host_emotion);
        }
        if (data.pipelineData?.stage5_selection?.host_position) {
          setSelectedHostPos(data.pipelineData.stage5_selection.host_position);
        }
      }
    } catch (e) {
      console.error("Fetch thumbnail error:", e);
    }
  };

  const handleRunPipelineAction = async (action: string, payloadOverride: any = {}) => {
    setIsExecutingPipeline(true);
    setPipelineActionMsg(`Đang thực hiện: ${action}...`);

    try {
      const targetTitle = customThumbTitle.trim() || selectedThumbTitle || generatedTitle;
      const isSyncAction = ['composite', 'select_concept', 'qc', 'recomposite'].includes(action);

      const res = await fetch('/api/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: currentStoryId,
          action,
          provider: selectedProvider,
          title: targetTitle,
          badge: selectedBadge,
          conceptId: selectedConceptId,
          emotion: selectedHostEmotion,
          hostPos: selectedHostPos,
          prompt: customPrompt.trim(),
          sync: isSyncAction,
          ...payloadOverride,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.pipelineData) {
          setThumbnailStatus((prev) => ({ ...prev, pipelineData: data.pipelineData }));
          setIsExecutingPipeline(false);
          setPipelineActionMsg('');
          fetchThumbnailStatus(currentStoryId);
        } else {
          // Poll every 3s
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts += 1;
            const checkRes = await fetch(`/api/thumbnail?storyId=${currentStoryId}`);
            const checkData = await checkRes.json();
            if (checkData.success) {
              setThumbnailStatus(checkData);
              if (checkData.hasFinalThumbnail || attempts > 50) {
                setIsExecutingPipeline(false);
                setPipelineActionMsg('');
                clearInterval(pollInterval);
              }
            }
          }, 3000);
        }
      } else {
        alert("Lỗi thực thi pipeline: " + data.error);
        setIsExecutingPipeline(false);
        setPipelineActionMsg('');
      }
    } catch (e: any) {
      alert("Lỗi kết nối API: " + e.message);
      setIsExecutingPipeline(false);
      setPipelineActionMsg('');
    }
  };

  const handleGenerateThumbnail = async (onlyComposite = false) => {
    if (onlyComposite) {
      handleRunPipelineAction('composite');
    } else {
      handleRunPipelineAction('full');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const progressPercent = audioStatus.totalChunks > 0 
    ? Math.min(100, Math.round((audioStatus.generatedChunks / audioStatus.totalChunks) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Hidden Global Audio Element */}
      <audio ref={audioPlayerRef} className="hidden" />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              auto_YT <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">VieNeu-TTS 48kHz Audio Studio</span>
            </h1>
            <p className="text-xs text-slate-400">Pipeline Kịch Bản 1h00 – 1h30 (11.000 – 12.500 từ) + VieNeu-TTS v3 Turbo 48kHz (Universal Multi-Role) • Sâm Kể Chuyện Style</p>
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
            <span>GPU: RTX 3060 (VieNeu 48kHz)</span>
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
        <div className="flex border-b border-slate-800 space-x-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'matrix' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            1. Ma trận Topic & Blueprint (5 Cụm Xung Đột)
          </button>
          <button
            onClick={() => setActiveTab('stepper')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'stepper' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin text-amber-400' : ''}`} />
            2. Tiến trình 6-Turn Playwright (1h-1h30)
          </button>
          <button
            onClick={() => setActiveTab('fullscript')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'fullscript' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            3. Kịch bản 10 Chương ({totalWords > 0 ? `${totalWords.toLocaleString()} từ` : '11.850 từ'})
          </button>
          <button
            onClick={() => setActiveTab('seo')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'seo' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            4. Metadata SEO & Outlier Thumbnail
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'audio' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Headphones className="w-4 h-4 text-amber-400" />
            5. VieNeu 48kHz Audio Studio (Universal Voices)
            {audioStatus.hasFullAudio && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => { setActiveTab('thumbnail'); fetchThumbnailStatus(); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'thumbnail' 
                ? 'border-amber-500 text-amber-400 bg-amber-500/5' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="w-4 h-4 text-amber-400" />
            6. Thumbnail AI Studio (Playwright GPT)
            {thumbnailStatus.hasFinalThumbnail && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Tab 1: Topic Matrix */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            {/* Conflict Cluster Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  Chọn Cụm Đề Tài Xung Đột Xã Hội (Conflict Matrix Clusters):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRandomizeAllClusters}
                    className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Đổi Cụm Xung Đột Ngẫu Nhiên
                  </button>
                </div>
              </div>

              {/* 5 Conflict Clusters Cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {CLUSTERS.map((c, idx) => {
                  const isSelected = idx === selectedClusterIndex;
                  return (
                    <button
                      key={c.id}
                      onClick={() => applyCluster(idx)}
                      className={`text-left p-3.5 rounded-xl border transition flex flex-col justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-amber-950/40 border-amber-500 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                            isSelected 
                              ? 'bg-amber-500 text-slate-950 border-amber-400' 
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {c.badge}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            Xưng: <strong className="text-amber-300">{c.default_pronoun}</strong>
                          </span>
                        </div>
                        <div className="font-bold text-xs leading-snug text-slate-100">{c.name}</div>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                        {c.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Role Mapping Preview */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  Phân Vai Đang Chọn:
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                  Nạn nhân: <strong>{currentCluster.victim_role_name}</strong> (Xưng "{currentCluster.default_pronoun}")
                </span>
                <span className="px-2 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-500/30">
                  Đối kháng 1: <strong>{currentCluster.antagonist_1_name}</strong>
                </span>
                <span className="px-2 py-0.5 rounded bg-orange-950/60 text-orange-300 border border-orange-500/30">
                  Đối kháng 2: <strong>{currentCluster.antagonist_2_name}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRandomizeWithinCluster}
                  className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Xáo Trộn Biến Số Cụm Này
                </button>
              </div>
            </div>

            {/* Generated Title Banner */}
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Tiêu đề Kịch tính Chuẩn Outlier Lách Kiểm duyệt
                </span>
                <span className="text-xs text-slate-400">
                  Thời lượng dự kiến: <strong className="text-amber-300 font-mono">1h00 – 1h30</strong> (10 Chương)
                </span>
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
              {/* Archetypes */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  1. Thân phận & Phẩm chất Nạn nhân / Nhân vật chính
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {currentCluster.archetypes.map((a) => (
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
                      <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{a.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sacrifices */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <HeartHandshake className="w-4 h-4 text-pink-400" />
                  2. Sự hy sinh ban đầu (Tạo lòng trắc ẩn)
                </label>
                <div className="space-y-2">
                  {currentCluster.sacrifices.map((s, idx) => (
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

              {/* Oppressions */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-red-400" />
                  3. Hành vi áp bức & Bạc bẽo (Xung đột dâng cao)
                </label>
                <div className="space-y-2">
                  {currentCluster.oppressions.map((o, idx) => (
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

              {/* Secrets & Retributions */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-400" />
                  4. Cú Lật Kèo & Công Lý Thực Thi
                </label>
                <div className="space-y-2">
                  {currentCluster.retributions.map((r, idx) => (
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
                className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold px-7 py-3.5 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer disabled:opacity-50"
              >
                {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Khởi chạy Playwright ChatGPT Sinh Kịch Bản 1h00 – 1h30 (6 Turns)
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
                  Tiến trình Tự động hóa 6 Lượt (Playwright ChatGPT Session • 1h00 – 1h30)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Đang chạy trên profile <span className="text-indigo-400 font-mono">PROFILE_GPT_1</span> với context liên tục
                </p>
              </div>
              <div className="text-xs font-mono text-amber-400 px-3 py-1 rounded bg-amber-500/10 border border-amber-500/30">
                {totalWords.toLocaleString()} từ / Mục tiêu: 11.000 – 12.500 từ
              </div>
            </div>

            {/* 6 Turn Steps */}
            <div className="space-y-3.5">
              {[
                { turn: 1, name: 'Turn 1: Master Blueprint & Dàn ý 10 Chương (Chuẩn 1h00 - 1h30)', data: turnData.turn1_blueprint },
                { turn: 2, name: 'Turn 2: Hồi 1 & Hồi 2 (Chương 1 - 3: ~3.500 từ - Khởi đầu & Hy sinh)', data: turnData.turn2_chapters_1_3 },
                { turn: 3, name: 'Turn 3: Hồi 2 & Hồi 3 (Chương 4 - 6: ~3.800 từ - Áp bức & Âm thầm điều tra)', data: turnData.turn3_chapters_4_6 },
                { turn: 4, name: 'Turn 4: Hồi 4 (Chương 7 - 9: ~3.800 từ - Bắt quả tang, Lật kèo & Công lý)', data: turnData.turn4_chapters_7_9 },
                { turn: 5, name: 'Turn 5: Hồi 5 (Chương 10 & Lời kết Bác Sâm: ~1.500 từ - Nhân quả & Bình yên)', data: turnData.turn5_chapter_10_outro },
                { turn: 6, name: 'Turn 6: Trọn bộ Metadata SEO & Prompt Thumbnail Outlier', data: turnData.turn6_metadata_seo },
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
                <h3 className="font-bold text-white text-base">{generatedTitle || 'Kịch bản Mẫu: Sâm Kể Chuyện'}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Độ dài: <span className="text-amber-400 font-semibold">{totalWords > 0 ? totalWords.toLocaleString() : '11.850'} từ</span> (~1.4 giờ audio • Chuẩn 10 Chương Sâm Kể Chuyện)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('audio')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition cursor-pointer"
                >
                  <Headphones className="w-4 h-4" />
                  Chuyển sang Audio Studio
                </button>
                <button
                  onClick={() => copyToClipboard(turnData.full_script || '')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Đã sao chép' : 'Sao chép kịch bản'}
                </button>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 max-h-[600px] overflow-y-auto space-y-4 text-sm text-slate-300 leading-relaxed font-sans whitespace-pre-wrap selection:bg-amber-500/20">
              {turnData.full_script || "Đang tải nội dung kịch bản hoặc mở từ story_test_01..."}
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
                onClick={() => copyToClipboard(turnData.turn6_metadata_seo || '')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Đã sao chép' : 'Sao chép Metadata'}
              </button>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 max-h-[600px] overflow-y-auto text-sm text-slate-300 whitespace-pre-wrap font-mono selection:bg-amber-500/20">
              {turnData.turn6_metadata_seo || "Chưa có dữ liệu Metadata SEO."}
            </div>
          </div>
        )}

        {/* Tab 5: VieNeu-TTS 48kHz Audio Studio */}
        {activeTab === 'audio' && (
          <div className="space-y-6">
            {/* Studio Header & Demo Audio Highlights */}
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-indigo-950/40 border border-amber-500/30 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      VieNeu-TTS v3 Turbo 48kHz (Native Vietnamese Prosody)
                    </span>
                    <span className="text-xs font-mono text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                      Chuẩn Phòng Thu 48.000 Hz
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white mt-2">
                    Ma Trận 9 Giọng Lồng Tiếng Biểu Cảm Cho Mọi Thân Phận Nạn Nhân & Kẻ Đối Kháng
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Ngữ điệu tiếng Việt tự nhiên, trầm ấm lắng đọng ở lời dẫn và sắc thái đối thoại rõ nét theo chuẩn phát thanh EBU R128 (-16 LUFS).
                  </p>
                </div>

                {/* Master Audio Demo Player */}
                <div className="bg-slate-950/80 border border-amber-500/40 rounded-xl p-4 flex flex-col gap-2 md:min-w-[340px]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Bản Demo Master Đa Phân Vai
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      48kHz · EBU R128
                    </span>
                  </div>
                  <audio 
                    controls 
                    className="w-full h-8 mt-1"
                    src="/api/audio?file=test_voices/new_clones_demo.mp3"
                  />
                </div>
              </div>
            </div>

            {/* 9 Voice Character Cards Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-400" />
                  Danh Sách 9 Profile Giọng Đọc Đa Dạng (Universal Voice Profiles):
                </h4>
                <span className="text-xs text-slate-400">
                  Cụm đang chọn: <strong className="text-amber-300">{currentCluster.name}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALL_VOICE_CARDS.map((v) => {
                  const isPlaying = playingVoice === v.id;
                  const isHost = v.id === 'bac_sam';
                  const isVictim = v.id === currentCluster.voice_preset.victim;
                  const isAntagonist1 = v.id === currentCluster.voice_preset.antagonist_1;
                  const isAntagonist2 = v.id === currentCluster.voice_preset.antagonist_2;
                  const isJustice = v.id === currentCluster.voice_preset.justice;
                  const isActiveInCurrentCluster = isHost || isVictim || isAntagonist1 || isAntagonist2 || isJustice;

                  return (
                    <div 
                      key={v.id}
                      className={`border rounded-xl p-5 space-y-3 transition flex flex-col justify-between ${
                        isActiveInCurrentCluster
                          ? 'bg-slate-900/90 border-amber-500/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/20'
                          : 'bg-slate-900/40 border-slate-800/80 opacity-75 hover:opacity-100 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-amber-400" />
                              {v.name}
                            </h4>
                            <div className="text-xs text-amber-400/90 font-medium mt-0.5">{v.role}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                              {v.quality}
                            </span>
                            {isActiveInCurrentCluster && (
                              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded">
                                {isHost ? 'Host' : isVictim ? 'Nạn Nhân' : isAntagonist1 ? 'Đối Kháng 1' : isAntagonist2 ? 'Đối Kháng 2' : 'Công Lý'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-indigo-300 bg-indigo-950/40 px-2 py-1 rounded border border-indigo-500/20">
                          {v.model}
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {v.desc}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                        <button
                          onClick={() => playVoiceSample(v.id, v.file)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            isPlaying 
                              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          {isPlaying ? 'Tạm dừng' : 'Nghe giọng mẫu'}
                        </button>
                        <span className="text-[10px] text-slate-400">
                          Style: <strong className="text-slate-200">{v.style}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Batch Production & Mixing Control Panel */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-amber-400" />
                    Bảng Điều Khiển Batch Lồng Tiếng & Mix Master (48kHz)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Tự động phân vai linh hoạt theo kịch bản, ghép nối micro-pause chuẩn nhịp thở và nén nhạc nền BGM sidechain ducking.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                    Tiến độ: <span className="text-amber-400 font-bold">{audioStatus.generatedChunks}</span> / {audioStatus.totalChunks || 835} chunks ({progressPercent}%)
                  </div>
                </div>
              </div>

              {/* Controls Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Engine Lồng Tiếng:</label>
                  <select
                    value={selectedEngine}
                    onChange={(e: any) => setSelectedEngine(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="vieneu">VieNeu-TTS v3 Turbo (48kHz Local GPU)</option>
                    <option value="edge_tts">Edge-TTS Neural (Microsoft Broadcast VTV/VOV)</option>
                    <option value="omnivoice">OmniVoice (24kHz Fallback)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Phạm vi Chương:</label>
                  <select
                    value={selectedChapter}
                    onChange={(e) => setSelectedChapter(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="all">Toàn bộ 10 Chương (~835 chunks)</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                      <option key={c} value={c}>Chương {c}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Giới hạn số lượng (Test):</label>
                  <select
                    value={selectedLimit}
                    onChange={(e) => setSelectedLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="all">Toàn bộ (Không giới hạn)</option>
                    <option value="5">5 chunks (~30 giây)</option>
                    <option value="20">20 chunks (~2 phút)</option>
                    <option value="50">50 chunks (~5 phút)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleStartAudioSynthesis}
                    disabled={isSynthesizing}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold p-2.5 rounded-lg shadow-lg shadow-amber-500/20 transition cursor-pointer text-xs disabled:opacity-50"
                  >
                    {isSynthesizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                    {isSynthesizing ? 'Đang Lồng Tiếng GPU...' : 'Khởi Chạy VieNeu 48kHz'}
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Tiến trình hoàn thiện Audio Master (48kHz):</span>
                  <span className="font-mono text-amber-400 font-semibold">{progressPercent}%</span>
                </div>
                <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full transition-all duration-500 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Master Full Story Audio Player Section */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-white text-sm flex items-center gap-2">
                      <Music className="w-4 h-4 text-amber-400" />
                      File Audio Truyện Hoàn Chỉnh (full_story_audio.mp3)
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Đã ghép nối đa nhân vật kèm ngắt nhịp tự nhiên theo tiêu chuẩn phát thanh YouTube
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href="/api/audio?storyId=test_01&file=full_story_audio.mp3"
                      download="full_story_audio.mp3"
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer border border-slate-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Tải File MP3 Master
                    </a>
                  </div>
                </div>

                <audio 
                  controls 
                  className="w-full h-10 mt-2"
                  src="/api/audio?storyId=test_01&file=full_story_audio.mp3"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Thumbnail AI Studio (10-Stage Pipeline) */}
        {activeTab === 'thumbnail' && (
          <div className="space-y-6">
            {/* Header / Pipeline Overview Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30">
                      DETERMINISTIC LAYERED
                    </span>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-amber-400" />
                      Thumbnail AI Studio • Khóa 100% Nhận Diện Host Bác Sâm
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    Quy trình Tách Lớp Tất Định: SRT → DNA → 3 Concept → Typography Plan (BeVietnamPro-Bold) → AI sinh Drama Scene sạch (NO Host, NO Text) → Tách nền Host Cutout (rembg) + Bóng đổ → Ghép Lớp Đồ Họa Tất Định → Dual QC.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 font-semibold">Scene Engine:</span>
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="bg-transparent text-xs text-amber-300 font-semibold focus:outline-none cursor-pointer"
                    >
                      <option value="playwright_chatgpt" className="bg-slate-900 text-slate-200">Playwright ChatGPT (PROFILE_GPT_1)</option>
                      <option value="mock" className="bg-slate-900 text-slate-200">Mock Fallback (Testing Nhanh)</option>
                      <option value="openai" className="bg-slate-900 text-slate-200">OpenAI DALL-E 3 (Direct API)</option>
                      <option value="gemini" className="bg-slate-900 text-slate-200">Google Imagen 3 (9Router)</option>
                    </select>
                  </div>

                  <button
                    onClick={() => handleRunPipelineAction('full')}
                    disabled={isExecutingPipeline}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 text-xs font-bold transition cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {isExecutingPipeline ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {isExecutingPipeline ? (pipelineActionMsg || 'Đang thực thi...') : '🚀 Chạy Toàn Bộ 10 Stage'}
                  </button>

                  <button
                    onClick={() => handleRunPipelineAction('composite')}
                    disabled={isExecutingPipeline}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer shadow-md shadow-emerald-600/20"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Ghép Lớp Lại (Stage 7C)
                  </button>

                  <button
                    onClick={() => fetchThumbnailStatus()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer border border-slate-700"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Làm mới
                  </button>
                </div>
              </div>

              {/* 10-Stage Horizontal Tracker */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="grid grid-cols-5 md:grid-cols-10 gap-1.5">
                  {[
                    { id: 'stage0', label: '0. SRT & Host', icon: FileText },
                    { id: 'stage1', label: '1. Single Story', icon: ShieldCheck },
                    { id: 'stage2', label: '2. Drama DNA', icon: Flame },
                    { id: 'stage3', label: '3. 3 Concepts', icon: Layers },
                    { id: 'stage4', label: '4. VN Hooks', icon: Type },
                    { id: 'stage5', label: '5. Fit & Layout', icon: CheckCircle2 },
                    { id: 'stage6', label: '6. Scene Prompt', icon: Wand2 },
                    { id: 'stage7a', label: '7A. Drama Scene', icon: ImageIcon },
                    { id: 'stage7c', label: '7C. Composite', icon: Palette },
                    { id: 'stage8', label: '8. Dual QC', icon: Eye },
                  ].map((st, idx) => {
                    const completed = thumbnailStatus.pipelineData?.stages_completed?.includes(st.id) || 
                      (st.id === 'stage7a' && thumbnailStatus.hasRawImage) ||
                      (st.id === 'stage7c' && thumbnailStatus.hasFinalThumbnail);
                    const IconComp = st.icon;
                    return (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg border text-center transition flex flex-col items-center justify-center gap-1 ${
                          completed
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : 'bg-slate-950/40 border-slate-800 text-slate-500'
                        }`}
                      >
                        <IconComp className={`w-3.5 h-3.5 ${completed ? 'text-emerald-400' : 'text-slate-600'}`} />
                        <span className="text-[10px] font-medium truncate w-full">{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Stage 1 & Stage 2 Insights: Story Consistency & Drama DNA */}
            {/* Stage 1 & Stage 2 Insights: Single-Story Integrity & Drama DNA */}
            {thumbnailStatus.pipelineData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Stage 1: Single-Story Integrity Gate Card */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Stage 1: Thẩm Định Tính Toàn Vẹn Câu Chuyện
                    </h4>
                    {thumbnailStatus.pipelineData.stage1_consistency && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        thumbnailStatus.pipelineData.stage1_consistency.integrity_status === 'clean'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}>
                        {thumbnailStatus.pipelineData.stage1_consistency.integrity_status || 'clean'}
                      </span>
                    )}
                  </div>

                  {thumbnailStatus.pipelineData.stage1_consistency ? (
                    <div className="space-y-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-slate-400 block text-[11px] font-semibold text-emerald-400">Tóm tắt Cốt lõi (Single Story):</span>
                        <p className="text-slate-300 text-[11px] mt-1 line-clamp-3">
                          {thumbnailStatus.pipelineData.stage1_consistency.story_summary || 'Đã thẩm định 100% câu chuyện hoàn chỉnh.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span>Nhân vật:</span>
                        <div className="flex flex-wrap gap-1">
                          {thumbnailStatus.pipelineData.stage1_consistency.characters?.map((c: any, i: number) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                              {typeof c === 'string' ? c : c.canonical_name || c.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      {thumbnailStatus.pipelineData.stage1_consistency.warnings?.length > 0 && (
                        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                          <strong>Cảnh báo (Thông tin):</strong> {thumbnailStatus.pipelineData.stage1_consistency.warnings.join('; ')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Chưa chạy Stage 1. Bấm "Chạy Toàn Bộ 10 Stage" để phân tích.</p>
                  )}
                </div>

                {/* Stage 2: Thumbnail DNA Card */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-400" />
                      Stage 2: Hạt Nhân Cảm Xúc & Thị Giác (DNA)
                    </h4>
                    {thumbnailStatus.pipelineData.stage5_selection?.host_emotion && (
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 font-bold uppercase flex items-center gap-1">
                        Host: {thumbnailStatus.pipelineData.stage5_selection.host_emotion}
                      </span>
                    )}
                  </div>

                  {thumbnailStatus.pipelineData.stage2_dna ? (
                    <div className="space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                          <span className="text-[10px] text-amber-400 font-semibold block">Nạn nhân (Victim):</span>
                          <span className="text-slate-200 font-semibold line-clamp-2">
                            {typeof thumbnailStatus.pipelineData.stage2_dna.victim === 'string'
                              ? thumbnailStatus.pipelineData.stage2_dna.victim
                              : thumbnailStatus.pipelineData.stage2_dna.victim?.description || thumbnailStatus.pipelineData.stage2_dna.victim?.name}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                          <span className="text-[10px] text-red-400 font-semibold block">Kẻ áp bức (Aggressor):</span>
                          <span className="text-slate-200 font-semibold line-clamp-2">
                            {typeof thumbnailStatus.pipelineData.stage2_dna.aggressor === 'string'
                              ? thumbnailStatus.pipelineData.stage2_dna.aggressor
                              : thumbnailStatus.pipelineData.stage2_dna.aggressor?.description || thumbnailStatus.pipelineData.stage2_dna.aggressor?.name}
                          </span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px]">
                        <span className="text-slate-400 font-semibold block text-amber-400">Vật chứng kịch tính (Key Prop):</span>
                        <p className="text-slate-300 font-medium">
                          {typeof thumbnailStatus.pipelineData.stage2_dna.key_prop === 'string'
                            ? thumbnailStatus.pipelineData.stage2_dna.key_prop
                            : thumbnailStatus.pipelineData.stage2_dna.key_prop?.name || thumbnailStatus.pipelineData.stage2_dna.key_prop?.visual_detail}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Chưa trích xuất DNA thị giác.</p>
                  )}
                </div>
              </div>
            )}

            {/* Stage 3: 3 Differentiated Concepts Studio */}
            {thumbnailStatus.pipelineData?.stage3_concepts?.concepts && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-amber-400" />
                      Stage 3: Ba Concept Phân Nhánh (A / B / C)
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Bấm vào bất kỳ Concept nào để chuyển hướng Prompt và tạo biến thể hình ảnh tương ứng.
                    </p>
                  </div>
                  <button
                    onClick={() => handleRunPipelineAction('concepts')}
                    disabled={isExecutingPipeline}
                    className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Sinh lại 3 Concept
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {thumbnailStatus.pipelineData.stage3_concepts.concepts.map((cp: any, idx: number) => {
                    const isSelected = (selectedConceptId || 'A') === cp.concept_id;
                    const badgeColors: Record<string, string> = {
                      confrontation: 'bg-red-500/20 text-red-300 border-red-500/40',
                      mystery: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
                      emotional_shock: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                    };

                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedConceptId(cp.concept_id);
                          handleRunPipelineAction('select_concept', { conceptId: cp.concept_id });
                        }}
                        className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between space-y-3 ${
                          isSelected
                            ? 'bg-amber-500/10 border-amber-500/60 shadow-lg shadow-amber-500/10'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${badgeColors[cp.concept_type] || 'bg-slate-800 text-slate-300'}`}>
                              Concept {cp.concept_id} • {cp.concept_type}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-amber-400">
                              Zone: {cp.text_zone || 'left'}
                            </span>
                          </div>

                          <h5 className="text-xs font-bold text-white">{cp.concept_name || cp.name_vn}</h5>
                          <p className="text-xs text-slate-300 leading-relaxed">{cp.story_moment || cp.hook_summary}</p>
                          
                          <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                            <p><strong className="text-slate-300">Vật chứng:</strong> {cp.key_prop || cp.key_prop_detail}</p>
                            <p><strong className="text-slate-300">Gợi ý Hook:</strong> {cp.suggested_hook}</p>
                          </div>
                        </div>

                        <div className="pt-2">
                          <button
                            type="button"
                            className={`w-full py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {isSelected ? <Check className="w-3.5 h-3.5" /> : null}
                            {isSelected ? 'Concept Đang Chọn' : 'Chọn Concept Này'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stage 4: 12+ Vietnamese Hooks Engine & Typography Plan */}
            {thumbnailStatus.pipelineData?.stage4_hooks?.hooks && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Type className="w-4 h-4 text-amber-400" />
                      Stage 4: Kho Hook Tiếng Việt & Typography Plan (12+ Biến Thể)
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Mỗi hook đã được thiết kế sẵn ngắt dòng, phân màu Vàng/Đỏ và vùng đặt chữ tối ưu. Bấm để chọn và tự động cập nhật.
                    </p>
                  </div>

                  {/* Category Filter Tabs */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    {[
                      { id: 'all', label: 'Tất cả' },
                      { id: 'mystery', label: 'Bí ẩn' },
                      { id: 'shock', label: 'Sốc / Lật mặt' },
                      { id: 'emotional', label: 'Đau thương' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setSelectedHookCategory(tab.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          selectedHookCategory === tab.id
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {thumbnailStatus.pipelineData.stage4_hooks.hooks
                    .filter((h: any) => selectedHookCategory === 'all' || h.category === selectedHookCategory)
                    .map((h: any, idx: number) => {
                      const isChosen = (customThumbTitle || selectedThumbTitle) === h.text;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setSelectedThumbTitle(h.text);
                            setCustomThumbTitle(h.text);
                            handleRunPipelineAction('select_concept', { hookId: h.id, title: h.text });
                          }}
                          className={`p-3.5 rounded-xl border transition cursor-pointer space-y-2 flex flex-col justify-between ${
                            isChosen
                              ? 'bg-amber-500/15 border-amber-500/60 shadow-md shadow-amber-500/10'
                              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                                #{idx + 1} • {h.category}
                              </span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                                {h.preferred_text_zone || 'left'}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-amber-300 leading-snug">{h.text}</p>
                            
                            {/* Lines breakdown preview */}
                            {h.lines && h.lines.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {h.lines.map((l: string, li: number) => {
                                  const isYellow = h.yellow_words?.some((yw: string) => l.includes(yw));
                                  const isRed = h.red_words?.some((rw: string) => l.includes(rw));
                                  const colorBadge = isYellow 
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                                    : isRed 
                                    ? 'bg-red-500/20 text-red-300 border-red-500/40' 
                                    : 'bg-slate-800 text-slate-200 border-slate-700';
                                  return (
                                    <span key={li} className={`text-[9px] px-1.5 py-0.5 rounded border font-mono font-semibold ${colorBadge}`}>
                                      Dòng {li + 1}: {l}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 flex items-center justify-between">
                            <span>Style: <strong>{h.typography_style || 'bold_shock'}</strong></span>
                            <span className="text-amber-400">{isChosen ? '✓ Đang chọn' : 'Bấm để chọn'}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Stage 8: AI Dual Vision QC & Exact Text QC Report */}
            {thumbnailStatus.pipelineData?.stage8_qc && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Eye className="w-4 h-4 text-amber-400" />
                    Stage 8: Thẩm Định Song Song (AI Dual Vision & Exact Text QC)
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Visual QC Badge */}
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${
                      thumbnailStatus.pipelineData.stage8_qc.visual_passed
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-red-500/20 text-red-300 border-red-500/40'
                    }`}>
                      Visual QC: {thumbnailStatus.pipelineData.stage8_qc.visual_passed ? 'PASSED' : 'FAILED'}
                    </span>

                    {/* Text QC Badge */}
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${
                      thumbnailStatus.pipelineData.stage8_qc.text_passed
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : thumbnailStatus.pipelineData.stage8_qc.text_match === 'minor_error'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-red-500/20 text-red-300 border-red-500/40'
                    }`}>
                      Text QC: {thumbnailStatus.pipelineData.stage8_qc.text_match || (thumbnailStatus.pipelineData.stage8_qc.text_passed ? 'exact' : 'mismatch')}
                    </span>
                  </div>
                </div>

                {/* Text Inspection Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Tiêu đề kỳ vọng (Expected):</span>
                    <p className="text-slate-200 font-bold font-mono">
                      {thumbnailStatus.pipelineData.stage8_qc.expected_headline || 'Chưa xác định'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Chữ AI nhìn thấy trên ảnh (Detected):</span>
                    <p className={`font-bold font-mono ${thumbnailStatus.pipelineData.stage8_qc.text_passed ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {thumbnailStatus.pipelineData.stage8_qc.detected_headline || '(Không phát hiện chữ hoặc chưa có)'}
                    </p>
                  </div>
                </div>

                {/* Recommended Action & Issues */}
                {thumbnailStatus.pipelineData.stage8_qc.recommended_action && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                    <span className="text-slate-400">
                      Hành động đề xuất: <strong className="text-amber-300 uppercase font-mono">{thumbnailStatus.pipelineData.stage8_qc.recommended_action}</strong>
                    </span>
                    {thumbnailStatus.pipelineData.stage8_qc.recommended_action === 'typography_repair' && (
                      <button
                        onClick={() => handleRunPipelineAction('repair')}
                        disabled={isExecutingPipeline}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition cursor-pointer"
                      >
                        ⚡ Kích Hoạt Stage 9 Typography Repair
                      </button>
                    )}
                  </div>
                )}

                {thumbnailStatus.pipelineData.stage8_qc.issues?.length > 0 && (
                  <div className="space-y-2">
                    {thumbnailStatus.pipelineData.stage8_qc.issues.map((issue: any, i: number) => {
                      const sevColor = issue.severity === 'high'
                        ? 'bg-red-500/10 border-red-500/30 text-red-300'
                        : issue.severity === 'medium'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-300';
                      return (
                        <div key={i} className={`p-3 rounded-xl border text-xs space-y-1 ${sevColor}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-bold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                              {issue.severity === 'high' ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                              [{issue.severity}] {issue.type}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed">{issue.description}</p>
                          {issue.suggested_fix && (
                            <p className="text-[10px] text-slate-400">💡 Gợi ý khắc phục: {issue.suggested_fix}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Main 2-Column Grid: Prompt & Typography on Left, Live Preview on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Generator & Text Settings (5 Cols) */}
              <div className="lg:col-span-5 space-y-5">
                {/* 1. Prompt Settings (Drama Scene Only) */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Wand2 className="w-4 h-4 text-amber-400" />
                      Stage 6: Prompt Cảnh Drama (NO Host, NO Text):
                    </label>
                  </div>
                  <textarea
                    rows={5}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Mô tả bối cảnh xung đột kịch tính của câu chuyện..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-amber-500 leading-relaxed font-mono"
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      💡 AI chỉ tạo cảnh kịch tính; Host và Chữ được ghép lớp riêng biệt.
                    </span>
                    <button
                      onClick={() => handleRunPipelineAction('generate_image')}
                      disabled={isExecutingPipeline}
                      className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      🎨 Sinh Lại Cảnh Drama (7A)
                    </button>
                  </div>
                </div>

                {/* 2. Host Asset & Position Locking Panel */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-emerald-400" />
                      Stage 7B: Khóa Nhận Diện Host Bác Sâm (Brand Asset):
                    </label>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                      100% Zero Drift
                    </span>
                  </div>

                  {/* Emotion Selector Chips */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400">Biểu cảm Bác Sâm (Host Emotion):</span>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'serious', label: '😐 Nghiêm nghị', name: 'serious' },
                        { id: 'anger', label: '😡 Phẫn nộ', name: 'anger' },
                        { id: 'shock', label: '😱 Sững sờ', name: 'shock' },
                        { id: 'grief', label: '😢 Xót xa', name: 'grief' },
                        { id: 'suspicious', label: '🤨 Hoài nghi', name: 'suspicious' },
                        { id: 'disbelief', label: '🧐 Bàng hoàng', name: 'disbelief' },
                      ].map((emo) => (
                        <button
                          key={emo.id}
                          type="button"
                          onClick={() => {
                            setSelectedHostEmotion(emo.name);
                            handleRunPipelineAction('composite', { emotion: emo.name });
                          }}
                          className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer text-center truncate ${
                            selectedHostEmotion === emo.name
                              ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {emo.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Host Position */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400">Vị trí đứng của Host:</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'left', label: '👈 Host Bên Trái (Mặc định)' },
                        { id: 'right', label: '👉 Host Bên Phải' },
                      ].map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          onClick={() => {
                            setSelectedHostPos(pos.id);
                            handleRunPipelineAction('composite', { hostPos: pos.id });
                          }}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer text-center ${
                            selectedHostPos === pos.id
                              ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 3. Shock Title & Typography Settings */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Type className="w-4 h-4 text-amber-400" />
                      Stage 7C: Tùy Chỉnh Tiêu Đề & Font Chữ (BeVietnamPro-Bold):
                    </label>
                  </div>

                  {/* Custom Title Input */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400">Tiêu đề tiếng Việt chuẩn (Gõ trực tiếp):</span>
                    <input
                      type="text"
                      value={customThumbTitle || selectedThumbTitle}
                      onChange={(e) => setCustomThumbTitle(e.target.value)}
                      placeholder="Nhập tiêu đề giật gân (ví dụ: ÉP BỐ KÝ ĐẤT?)..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-amber-300 font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {/* Badge Preset Selector */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400">Chọn Nhãn Badge Góc Trái (Branding):</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        '🎙️ SÂM KỂ CHUYỆN',
                        '🔥 KẾT ĐẮNG',
                        '⚡ LẬT KÈO',
                        '⭐ TRUYỆN MỚI',
                        '⚖️ CÔNG LÝ',
                        '💔 NƯỚC MẮT'
                      ].map((b, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedBadge(b);
                            handleRunPipelineAction('composite', { badge: b });
                          }}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer text-left truncate ${
                            selectedBadge === b
                              ? 'bg-red-500/20 border-red-500/60 text-red-300'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 4. Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleRunPipelineAction('full')}
                    disabled={isExecutingPipeline}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold p-3 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer text-xs disabled:opacity-50"
                  >
                    {isExecutingPipeline ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Chạy Toàn Bộ (Full + QC)
                  </button>

                  <button
                    onClick={() => handleRunPipelineAction('composite')}
                    disabled={isExecutingPipeline}
                    className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold p-3 rounded-xl shadow-md shadow-emerald-600/20 transition cursor-pointer text-xs disabled:opacity-50"
                  >
                    <Zap className="w-4 h-4" />
                    ⚡ Ghép Lớp Lại (&lt;100ms)
                  </button>
                </div>
              </div>

              {/* Right Column: Live Preview & Downloads (7 Cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Eye className="w-4 h-4 text-amber-400" />
                      Live Preview Thumbnail YouTube (1280x720 • 16:9 Standard)
                    </h4>
                    {thumbnailStatus.hasFinalThumbnail && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono font-semibold">
                        Xuất bản Ready (1280x720)
                      </span>
                    )}
                  </div>

                  {/* Image Display Box */}
                  <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center shadow-2xl">
                    {thumbnailStatus.finalThumbnailUrl ? (
                      <img
                        src={thumbnailStatus.finalThumbnailUrl}
                        alt="YouTube Thumbnail"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-6 space-y-2">
                        <ImageIcon className="w-12 h-12 text-slate-700 mx-auto animate-pulse" />
                        <p className="text-xs text-slate-400">Chưa có ảnh thumbnail hoàn thiện.</p>
                        <p className="text-[11px] text-slate-500">
                          Bấm nút <span className="text-amber-400 font-semibold">"Chạy Toàn Bộ (Full + QC)"</span> để tạo full thumbnail tự động.
                        </p>
                      </div>
                    )}

                    {/* YouTube Timestamp Overlay Simulation */}
                    {thumbnailStatus.finalThumbnailUrl && (
                      <div className="absolute bottom-3 right-3 bg-black/85 text-white font-bold text-[11px] px-1.5 py-0.5 rounded font-mono shadow-md pointer-events-none">
                        1:25:30
                      </div>
                    )}
                  </div>

                  {/* Action bar below preview */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div className="flex items-center gap-2">
                      {thumbnailStatus.hasFinalThumbnail && (
                        <a
                          href={`/api/thumbnail?storyId=${currentStoryId}&file=thumbnail_youtube.png`}
                          download="thumbnail_youtube.png"
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition cursor-pointer shadow-md shadow-amber-500/10"
                        >
                          <Download className="w-4 h-4" />
                          Tải Thumbnail YouTube (1280x720)
                        </a>
                      )}
                      {thumbnailStatus.hasRawImage && (
                        <a
                          href={`/api/thumbnail?storyId=${currentStoryId}&file=drama_scene_raw.png`}
                          download="drama_scene_raw.png"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer border border-slate-700"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Tải Cảnh Drama Gốc
                        </a>
                      )}
                    </div>

                    {thumbnailStatus.finalThumbnailUrl && (
                      <button
                        onClick={() => copyToClipboard(window.location.origin + thumbnailStatus.finalThumbnailUrl)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 text-xs font-mono transition cursor-pointer border border-slate-800"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Đã sao chép link' : 'Copy URL'}
                      </button>
                    )}
                  </div>
                </div>

                {/* AI Generated Drama Scene Preview Drawer */}
                {thumbnailStatus.hasRawImage && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                    <span className="text-[11px] text-slate-400 font-semibold block">
                      Ảnh bối cảnh Drama do AI tạo ra (Stage 7A: drama_scene_raw.png):
                    </span>
                    <div className="aspect-video w-full rounded-lg overflow-hidden bg-slate-950 border border-slate-800 max-h-48">
                      <img
                        src={`/api/thumbnail?storyId=${currentStoryId}&file=drama_scene_raw.png`}
                        alt="Drama Scene Raw"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>
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
