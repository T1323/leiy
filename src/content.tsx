import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import tailwindCss from "./content.css?inline";
import { processInterceptedCaptions, Subtitle } from "./utils/youtube";

interface TooltipState {
  word: string;
  definition: string | null;
  loading: boolean;
  x: number;
  y: number;
}

interface Config {
  showEn: boolean;
  showZh: boolean;
  fontSizeEn: number;
  fontSizeZh: number;
  sidebarFontSizeEn: number;
  sidebarFontSizeZh: number;
  shadowingAutoStart: boolean;
  shadowingFloatingUI: boolean;
  shadowingAutoHideSubs: boolean;
}

const DEFAULT_CONFIG: Config = {
  showEn: true,
  showZh: true,
  fontSizeEn: 36,
  fontSizeZh: 24,
  sidebarFontSizeEn: 16,
  sidebarFontSizeZh: 14,
  shadowingAutoStart: true,
  shadowingFloatingUI: false,
  shadowingAutoHideSubs: false,
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// Helper to calculate string similarity based on Levenshtein distance
const calculateSimilarity = (str1: string, str2: string): number => {
  const cleanStr1 = str1.replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const cleanStr2 = str2.replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim().toLowerCase();

  if (!cleanStr1 || !cleanStr2) return 0;
  if (cleanStr1 === cleanStr2) return 100;

  const track = Array(cleanStr2.length + 1).fill(null).map(() =>
    Array(cleanStr1.length + 1).fill(null)
  );

  for (let i = 0; i <= cleanStr1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= cleanStr2.length; j += 1) track[j][0] = j;

  for (let j = 1; j <= cleanStr2.length; j += 1) {
    for (let i = 1; i <= cleanStr1.length; i += 1) {
      const indicator = cleanStr1[i - 1] === cleanStr2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  const distance = track[cleanStr2.length][cleanStr1.length];
  const maxLength = Math.max(cleanStr1.length, cleanStr2.length);
  const similarity = ((maxLength - distance) / maxLength) * 100;
  return Math.max(0, Math.round(similarity));
};

const getRandomComment = (score: number): string => {
  if (score >= 90) {
    const comments = [
      "太神啦！簡直跟母語人士一樣！",
      "完美發音！你是不是偷偷練了很久？",
      "太完美了，這發音無懈可擊！",
      "超強！請收下我的膝蓋！"
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  } else if (score >= 70) {
    const comments = [
      "發音很棒喔！再稍微雕琢一下就完美了！",
      "非常接近了，繼續保持這個語感！",
      "說得真好，聽得出來你很努力！",
      "太厲害了，就差一點點就能滿分！"
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  } else if (score >= 50) {
    const comments = [
      "很不錯的嘗試！多唸幾次會更好！",
      "漸入佳境！可以多注意連音和語調喔！",
      "已經掌握到一些感覺了，再接再厲！",
      "別氣餒，語言就是靠累積的，繼續加油！"
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  } else {
    const comments = [
      "萬事起頭難，有開口練習就是最棒的開始！",
      "沒關係，多聽幾次再跟著唸一定會進步！",
      "別灰心！我們再聽一次原音，慢慢來！",
      "每一次的練習都在進步，不要放棄喔！"
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  }
};

const ContentApp = () => {
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [translationSource, setTranslationSource] = useState<'native' | 'api' | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [abModeActive, setAbModeActive] = useState(false);
  const [abStart, setAbStart] = useState<number | null>(null);
  const [abEnd, setAbEnd] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isWatchPage, setIsWatchPage] = useState(window.location.pathname === '/watch');
  
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);

  // Shadowing Mode State
  const [isShadowing, setIsShadowing] = useState(false);
  const [isShadowingWaitingPlay, setIsShadowingWaitingPlay] = useState(false);
  const [shadowingTarget, setShadowingTarget] = useState<string | null>(null);
  const [shadowingResult, setShadowingResult] = useState<string | null>(null);
  const [shadowingScore, setShadowingScore] = useState<number | null>(null);
  const [shadowingComment, setShadowingComment] = useState<string | null>(null);
  const [shadowingError, setShadowingError] = useState<string | null>(null);
  const [shadowingOverlayVisible, setShadowingOverlayVisible] = useState(false);
  const [shadowingCompareMode, setShadowingCompareMode] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const recordingFileName = "shadowing_recording.webm";

  const currentSubtitleRef = useRef<Subtitle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSubtitleRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const originalVolumeRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<number | null>(null);
  const targetReachedRef = useRef<boolean>(false);

  useEffect(() => {
    chrome.storage.sync.get(['ytll_config'], (result) => {
      if (result.ytll_config) {
        setConfig({ ...DEFAULT_CONFIG, ...result.ytll_config });
      }
    });
  }, []);

  const updateConfig = (newConfig: Partial<Config>) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    chrome.storage.sync.set({ ytll_config: updated });
  };

  // Update currentSubtitleRef when currentTime or subtitles change
  useEffect(() => {
    const active = subtitles.find(s => currentTime >= s.start && currentTime < (s.start + s.duration));
    currentSubtitleRef.current = active || null;
  }, [currentTime, subtitles]);

  // Shadowing Web Speech Initialization & Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch(e) {}
      }
      if (silenceTimeoutRef.current) {
        window.clearTimeout(silenceTimeoutRef.current);
      }
      const video = document.querySelector("video");
      if (video && originalVolumeRef.current !== null) {
        video.volume = originalVolumeRef.current;
      }
    };
  }, []);

const stopMediaRecorder = () => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {
        console.error('Error stopping media recorder', e);
      }
      mediaRecorderRef.current = null;
    }
  };

  const stopShadowing = () => {
    if (silenceTimeoutRef.current) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Error stopping recognition", e);
      }
      recognitionRef.current = null;
    }

    stopMediaRecorder();
    
    setIsShadowing(false);
    setIsShadowingWaitingPlay(false);
    targetReachedRef.current = false;
    
    const video = document.querySelector("video");
    if (video && originalVolumeRef.current !== null) {
      video.volume = originalVolumeRef.current;
      originalVolumeRef.current = null;
    }
  };

  const startShadowingRecording = async () => {
    const video = document.querySelector("video");
    if (!video) return;

    if (originalVolumeRef.current === null) {
      originalVolumeRef.current = video.volume;
    }
    video.volume = 0.3; // Duck audio
    
    // Initialize Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setShadowingError("Speech Recognition API is not supported in this browser.");
      setIsShadowingWaitingPlay(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordingBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = false;
      
      recognition.onstart = () => {
        setIsShadowing(true);
        setIsShadowingWaitingPlay(false);
      };

      recognition.onresult = (event: any) => {
        const lines: string[] = [];
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            lines.push(event.results[i][0].transcript.trim());
          }
        }
        setShadowingResult(lines.join('|||'));

        // Reset silence timeout if target is reached
        if (targetReachedRef.current) {
          if (silenceTimeoutRef.current) window.clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = window.setTimeout(() => {
            stopShadowing();
          }, 5000);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
          setShadowingError("Microphone permission denied.");
        } else {
          setShadowingError(`Speech error: ${event.error}`);
        }
        stopShadowing();
      };

      recognition.onend = () => {
        if (isShadowing) {
          stopShadowing();
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      
    } catch (err: any) {
      console.error("Failed to start Speech Recognition", err);
      setShadowingError(err.message || "Failed to start Speech Recognition");
      stopShadowing();
    }
  };

  const startShadowing = () => {
    // Reset state
    setShadowingResult(null);
    setShadowingScore(null);
    setShadowingComment(null);
    setShadowingError(null);
    setShadowingOverlayVisible(false);
    setShadowingCompareMode(false);
    setRecordingBlob(null);
    setRecordingUrl(null);
    targetReachedRef.current = false;
    if (silenceTimeoutRef.current) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    const video = document.querySelector("video");
    if (!video) return;

    let targetText = "";
    
    if (abModeActive && abStart !== null && abEnd !== null) {
      // A-B Mode active
      const slice = subtitles.slice(abStart, abEnd + 1);
      targetText = slice.map(s => s.en).join(" ");
      if (config.shadowingAutoStart) video.currentTime = subtitles[abStart].start;
    } else {
      // Normal mode
      targetText = subtitles.map(s => s.en).join(" ");
      if (config.shadowingAutoStart) video.currentTime = 0;
    }

    setShadowingTarget(targetText);

    if (config.shadowingAutoStart) {
      video.play().then(() => {
        startShadowingRecording();
      }).catch(() => {
        // If auto-play blocked, fall back to waiting
        setIsShadowingWaitingPlay(true);
      });
    } else {
      setIsShadowingWaitingPlay(true);
    }
  };

  const toggleShadowing = () => {
    if (isShadowing || isShadowingWaitingPlay) {
      stopShadowing();
    } else {
      startShadowing();
    }
  };

  // Calculate score when shadowing finishes and result exists
  useEffect(() => {
    if (!isShadowing && shadowingResult && shadowingTarget) {
      const combinedResult = shadowingResult.replace(/\|\|\|/g, ' ');
      const score = calculateSimilarity(shadowingTarget, combinedResult);
      setShadowingScore(score);
      setShadowingComment(getRandomComment(score));
      setShadowingOverlayVisible(true);
    }
  }, [isShadowing, shadowingResult, shadowingTarget]);

  useEffect(() => {
    const handleNavigate = () => {
      const isWatch = window.location.pathname === '/watch';
      setIsWatchPage(isWatch);
      if (!isWatch) {
        setIsVisible(false);
      }
    };
    
    window.addEventListener('yt-navigate-finish', handleNavigate);
    // Also listen to popstate just in case
    window.addEventListener('popstate', handleNavigate);
    
    return () => {
      window.removeEventListener('yt-navigate-finish', handleNavigate);
      window.removeEventListener('popstate', handleNavigate);
    };
  }, []);

  // Adjust YouTube Layout when sidebar is toggled
  useEffect(() => {
    const body = document.body;
    let styleEl = document.getElementById('yt-learning-mode-styles');

    if (isVisible && isWatchPage) {
      body.style.width = '66.66%';
      body.style.position = 'relative';
      body.style.margin = '0';

      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'yt-learning-mode-styles';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        /* Hide everything but the player */
        ytd-masthead, #masthead-container, 
        #secondary, #secondary-inner,
        #comments, #below, ytd-engagement-panel-section-list-renderer {
          display: none !important;
        }
        
        /* Expand primary container */
        #primary {
          max-width: 100% !important;
          width: 100% !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        /* Adjust columns layout */
        #columns {
          max-width: 100% !important;
          margin: 0 !important;
        }

        /* The page manager should fill the left area */
        ytd-page-manager {
          margin-top: 0 !important;
        }

        /* Video player takes up the remaining space */
        ytd-watch-flexy {
          padding-top: 0 !important;
        }
        
        /* Hide native subtitles */
        .ytp-caption-window-container,
        #ytp-caption-window-container,
        .caption-window,
        .ytp-caption-segment,
        .ytp-captions-player-content {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
        
        /* Full body dark theme */
        body, html {
          background-color: #0f0f0f !important;
        }
      `;
    } else {
      body.style.width = '';
      body.style.position = '';
      body.style.margin = '';
      if (styleEl) {
        styleEl.remove();
      }
    }

    return () => {
      if (styleEl) styleEl.remove();
    }
  }, [isVisible, isWatchPage]);

  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      if (e.source === window && e.data && e.data.type === 'YT_CAPTIONS_INTERCEPT') {
        const { url, data, captionTracks } = e.data;
        if (!data || !data.events || data.events.length === 0) {
           setErrorMsg("Intercepted captions are empty.");
           return;
        }
        setLoading(true);
        setErrorMsg(null);
        try {
          const result = await processInterceptedCaptions(url, data, captionTracks);
          if (result.subtitles.length === 0) {
            setErrorMsg(`Failed to parse intercepted subtitles.`);
          }
          setSubtitles(result.subtitles);
          setTranslationSource(result.source);
        } catch(err: any) {
          setErrorMsg(err.message);
        }
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);

    // Inject the script into the main world
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/inject.js');
    (document.head || document.documentElement).appendChild(script);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Synchronize video time
  useEffect(() => {
    const video = document.querySelector("video");
    if (!video) return;

    const handlePlay = () => {
      if (isShadowingWaitingPlay) {
        if (abModeActive && abStart !== null && subtitles[abStart]) {
          video.currentTime = subtitles[abStart].start;
        } else {
          video.currentTime = 0;
        }
        startShadowingRecording();
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      // Auto-Stop Mechanism for Shadowing Mode
      if (isShadowing) {
        if (abModeActive && abStart !== null && abEnd !== null) {
          const endSub = subtitles[abEnd];
          if (endSub && video.currentTime >= endSub.start + endSub.duration + 2) {
            if (!targetReachedRef.current) {
              targetReachedRef.current = true;
              if (silenceTimeoutRef.current) window.clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = window.setTimeout(() => {
                stopShadowing();
              }, 5000);
            }
          }
        } else {
          const lastSub = subtitles[subtitles.length - 1];
          if (lastSub && video.currentTime >= lastSub.start + lastSub.duration + 2) {
            if (!targetReachedRef.current) {
              targetReachedRef.current = true;
              if (silenceTimeoutRef.current) window.clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = window.setTimeout(() => {
                stopShadowing();
              }, 5000);
            }
          }
        }
      }
      
      if (abModeActive && abStart !== null && abEnd !== null) {
        const startSub = subtitles[abStart];
        const endSub = subtitles[abEnd];
        if (startSub && endSub) {
          const endTime = endSub.start + endSub.duration;
          const startTime = startSub.start;
          
          if (!video.paused && video.currentTime >= endTime && video.currentTime < endTime + 2) {
            video.pause();
            if (!isShadowing) {
              video.currentTime = startTime;
            }
          }
        }
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
    };
  }, [abModeActive, abStart, abEnd, subtitles, isShadowing, isShadowingWaitingPlay]);

  // Auto-scroll to active subtitle
  useEffect(() => {
    if (activeSubtitleRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeEl = activeSubtitleRef.current;
      
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.clientHeight;
      const elTop = activeEl.offsetTop;
      const elBottom = elTop + activeEl.clientHeight;
      
      // If active element is out of view, scroll to it
      if (elTop < containerTop || elBottom > containerBottom) {
        container.scrollTo({
          top: elTop - container.clientHeight / 2 + activeEl.clientHeight / 2,
          behavior: "smooth"
        });
      }
    }
  }, [currentTime]);

  const handleSubtitleClick = (idx: number, start: number) => {
    const video = document.querySelector("video");
    
    if (abModeActive) {
      if (abStart !== null && abEnd !== null) {
        // Both set, clear and restart from clicked
        setAbStart(idx);
        setAbEnd(null);
        // Clear shadowing target when restarting A-B selection in shadowing mode
        if (isShadowing || isShadowingWaitingPlay) {
          setShadowingTarget(null);
        }
      } else if (abStart === null) {
        // First click
        setAbStart(idx);
      } else if (abStart !== null && abEnd === null) {
        // Second click
        if (idx < abStart) {
          // Clicked before start, update start, keep end null
          setAbStart(idx);
          // Clear shadowing target when restarting A-B selection in shadowing mode
          if (isShadowing || isShadowingWaitingPlay) {
            setShadowingTarget(null);
          }
        } else {
          // Clicked after or equal to start, set end
          setAbEnd(idx);
          
          // If in shadowing mode, update the shadowing target with new A-B range
          if (isShadowing || isShadowingWaitingPlay) {
            const slice = subtitles.slice(abStart, idx + 1);
            const newTarget = slice.map(s => s.en).join(" ");
            setShadowingTarget(newTarget);
          } else if (video) {
            // If not in shadowing mode, auto-play as before
            video.currentTime = subtitles[abStart].start;
            video.play();
          }
        }
      }
      return;
    }

    if (video) {
      video.currentTime = start;
      video.play();
    }
  };

  const handleWordClick = async (e: React.MouseEvent, wordText: string) => {
    e.stopPropagation();
    const video = document.querySelector("video");
    if (video) video.pause();

    const cleanWord = wordText.replace(/[^a-zA-Z-]/g, '').toLowerCase();
    if (!cleanWord) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const containerRect = scrollContainerRef.current?.parentElement?.getBoundingClientRect() || { top: 0, left: 0 };
    
    // If the click is from the video overlay, we need to adjust tooltip position relative to the root
    let tooltipX = rect.left;
    let tooltipY = Math.max(0, rect.top - 100);

    // If click is in sidebar, adjust to container
    if (rect.left > window.innerWidth * 0.66) {
      tooltipX = rect.left - containerRect.left;
      tooltipY = Math.max(0, rect.top - containerRect.top - 100);
    }
    
    setTooltip({
      word: cleanWord,
      definition: null,
      loading: true,
      x: tooltipX,
      y: tooltipY
    });

    try {
      const response = await chrome.runtime.sendMessage({ action: "LOOKUP_WORD", word: cleanWord });
      setTooltip(prev => prev ? { ...prev, definition: response.definition, loading: false } : null);
    } catch (error) {
      setTooltip(prev => prev ? { ...prev, definition: "Definition not found.", loading: false } : null);
    }
  };

  const handleCloseOverlay = () => {
    setShadowingOverlayVisible(false);
    setShadowingCompareMode(false);
    setShadowingScore(null);
    setShadowingComment(null);
    setShadowingResult(null);
    setShadowingTarget(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setRecordingBlob(null);
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
      setRecordingUrl(null);
    }
    // 直接關閉浮層時同時刪除原始錄音
  };

  const handleToggleCompare = () => {
    setShadowingCompareMode((prev) => !prev);
    setShadowingOverlayVisible(true);
  };

  const handlePlayRecording = () => {
    if (recordingUrl && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
    }
  };

  const handleSaveRecording = () => {
    if (!recordingBlob) return;
    const url = URL.createObjectURL(recordingBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = recordingFileName || 'shadowing_recording.webm';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const isShadowingComplete = !isShadowing && !isShadowingWaitingPlay && shadowingScore !== null && shadowingOverlayVisible;

  if (!isWatchPage) {
    return null; // Don't render anything if not on a watch page
  }

  return (
    <>
      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          className="fixed top-20 right-4 z-[9999] bg-red-600 text-white p-3 rounded-full shadow-xl hover:bg-red-700 transition-colors"
          title="Open Language Learn Subtitles"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
        </button>
      )}

      {isShadowingComplete && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none px-4">
          <div className="w-[70vw] max-w-[900px] min-h-[38vh] bg-black/95 border border-white/15 rounded-[36px] shadow-[0_40px_120px_rgba(0,0,0,0.75)] backdrop-blur-2xl p-10 text-center pointer-events-auto">
            <div className="text-[5rem] md:text-[6.5rem] font-extrabold tracking-tight text-white leading-none mb-4">
              {shadowingScore}%
            </div>
            <div className="text-5xl md:text-6xl font-bold text-white mb-2">
              {shadowingComment}
            </div>
            <div className="flex flex-wrap justify-center gap-3 mb-5">
              <button
                onClick={handleCloseOverlay}
                className="px-6 py-3 rounded-full bg-green-600 hover:bg-green-500 text-white font-semibold"
              >
                確定
              </button>
              <button
                onClick={handleToggleCompare}
                className="px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold"
              >
                {shadowingCompareMode ? '關閉比較' : '比較'}
              </button>
              <button
                onClick={handlePlayRecording}
                disabled={!recordingUrl}
                className="px-6 py-3 rounded-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                播放錄音
              </button>
              <button
                onClick={handleSaveRecording}
                disabled={!recordingBlob}
                className="px-6 py-3 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                另存錄音
              </button>
            </div>

            {shadowingCompareMode && (
              <div className="grid gap-5 md:grid-cols-2 text-left">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 max-h-[32vh] overflow-y-auto">
                  <div className="text-base md:text-lg uppercase tracking-[0.2em] text-gray-400 mb-3">字幕原文</div>
                  <p className="whitespace-pre-wrap text-gray-100 leading-relaxed text-xl md:text-2xl">
                    {shadowingTarget || '無可比較字幕'}
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 max-h-[32vh] overflow-y-auto">
                  <div className="text-base md:text-lg uppercase tracking-[0.2em] text-gray-400 mb-3">錄音判讀</div>
                  <p className="whitespace-pre-wrap text-gray-100 leading-relaxed text-xl md:text-2xl">
                    {shadowingResult ? shadowingResult.split('|||').filter(Boolean).join(' ') : '無錄音判讀結果'}
                  </p>
                </div>
              </div>
            )}

            <audio ref={audioRef} src={recordingUrl ?? undefined} hidden />
          </div>
        </div>
      )}

      {isVisible && currentSubtitleRef.current && (config.showEn || config.showZh) && !((isShadowing || isShadowingWaitingPlay) && config.shadowingAutoHideSubs) && (
        <div 
          className="fixed z-[9998] pointer-events-none flex flex-col items-center justify-end pb-24"
          style={{
            left: 0,
            bottom: 0,
            width: '66.66%',
            height: '100vh',
          }}
        >
          <div className="bg-black/70 px-8 py-6 rounded-2xl text-center pointer-events-auto max-w-[85%] backdrop-blur-sm border border-white/10 flex flex-col items-center justify-center">
            {config.showEn && (
              <p className="text-white font-bold drop-shadow-lg leading-tight tracking-wide" style={{ fontSize: `${config.fontSizeEn}px`, marginBottom: config.showZh ? '16px' : '0' }}>
                {currentSubtitleRef.current.en.split(' ').map((word, wIdx) => (
                  <span 
                    key={wIdx} 
                    onClick={(e) => handleWordClick(e, word)}
                    className="hover:text-yellow-400 cursor-pointer transition-colors"
                  >
                    {word}{" "}
                  </span>
                ))}
              </p>
            )}
            {config.showZh && (
              <p className="text-gray-300 font-medium tracking-wide drop-shadow-md" style={{ fontSize: `${config.fontSizeZh}px` }}>
                {currentSubtitleRef.current.zh}
              </p>
            )}
          </div>
        </div>
      )}

      {isVisible && (
        <div className="fixed top-0 right-0 w-1/3 h-screen bg-[#111111] shadow-2xl z-[9999] border-l border-gray-800 flex flex-col p-4 text-gray-200">
          <div className="flex justify-between items-center mb-4 shrink-0 border-b border-gray-800 pb-5">
            <h2 className="text-3xl font-extrabold text-gray-100 flex items-center gap-3">
              <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
              </svg>
              YtLL
            </h2>
            <div className="flex gap-3 items-center">
              <button
                onClick={toggleShadowing}
                className={`px-4 py-2 rounded-lg text-base font-bold transition-colors flex items-center gap-2 ${
                  isShadowing || isShadowingWaitingPlay
                    ? "bg-red-600/80 text-white hover:bg-red-700 shadow-md border border-red-500" 
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
                title="Toggle Shadowing Mode"
              >
                {isShadowing || isShadowingWaitingPlay ? (
                  <>
                    <span className={`w-2.5 h-2.5 rounded-full bg-white ${isShadowing ? 'animate-pulse' : ''}`}></span>
                    Stop 錄音
                  </>
                ) : (
                  <>
                    🎤 Shadowing
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  const nextState = !abModeActive;
                  setAbModeActive(nextState);
                  if (nextState) {
                    setAbStart(null);
                    setAbEnd(null);
                  }
                }}
                className={`px-4 py-2 rounded-lg text-base font-bold transition-colors flex items-center gap-2 ${
                  abModeActive 
                    ? "bg-green-600 text-white hover:bg-green-700 shadow-md" 
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
                title="Toggle A-B Segment Mode"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                A-B 區間
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
                title="Settings"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              <button 
                onClick={() => setIsVisible(false)}
                className="text-gray-400 hover:text-red-500 transition-colors ml-1 p-2"
                title="Close Sidebar"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          {showSettings && (
            <div className="bg-gray-800 rounded-xl p-6 mb-4 shadow-inner border border-gray-700 animate-fade-in text-lg">
              <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
                <h3 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                  Display Settings
                </h3>
                <span className="text-xs font-semibold bg-blue-900/50 text-blue-300 px-3 py-1 rounded-full border border-blue-800/50 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z"/></svg>
                  Synced with Google
                </span>
              </div>
              
              <div className="space-y-6">
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-gray-200 font-bold flex items-center gap-2">
                      English Subtitles
                      <span className="text-[10px] bg-gray-700 text-gray-300 px-2 py-0.5 rounded uppercase tracking-wider">Source: YouTube</span>
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.showEn} onChange={(e) => updateConfig({ showEn: e.target.checked })} />
                      <div className="w-14 h-7 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                  
                  {config.showEn && (
                    <div className="space-y-4 pl-2 pr-2">
                      <div>
                        <div className="flex justify-between text-base text-gray-400 mb-2">
                          <span>Video Overlay Size</span>
                          <span className="font-mono bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-sm">{config.fontSizeEn}px</span>
                        </div>
                        <input 
                          type="range" min="16" max="64" step="2"
                          value={config.fontSizeEn}
                          onChange={(e) => updateConfig({ fontSizeEn: parseInt(e.target.value) })}
                          className="w-full h-2.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-base text-gray-400 mb-2">
                          <span>Sidebar List Size</span>
                          <span className="font-mono bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-sm">{config.sidebarFontSizeEn}px</span>
                        </div>
                        <input 
                          type="range" min="12" max="32" step="1"
                          value={config.sidebarFontSizeEn}
                          onChange={(e) => updateConfig({ sidebarFontSizeEn: parseInt(e.target.value) })}
                          className="w-full h-2.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-gray-200 font-bold flex items-center gap-2">
                      Chinese Subtitles
                      {translationSource && (
                        <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${translationSource === 'native' ? 'bg-green-900/60 text-green-300' : 'bg-purple-900/60 text-purple-300'}`}>
                          Source: {translationSource === 'native' ? 'Native Track' : 'API Fallback'}
                        </span>
                      )}
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.showZh} onChange={(e) => updateConfig({ showZh: e.target.checked })} />
                      <div className="w-14 h-7 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>

                  {config.showZh && (
                    <div className="space-y-4 pl-2 pr-2">
                      <div>
                        <div className="flex justify-between text-base text-gray-400 mb-2">
                          <span>Video Overlay Size</span>
                          <span className="font-mono bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-sm">{config.fontSizeZh}px</span>
                        </div>
                        <input 
                          type="range" min="12" max="48" step="2"
                          value={config.fontSizeZh}
                          onChange={(e) => updateConfig({ fontSizeZh: parseInt(e.target.value) })}
                          className="w-full h-2.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-base text-gray-400 mb-2">
                          <span>Sidebar List Size</span>
                          <span className="font-mono bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-sm">{config.sidebarFontSizeZh}px</span>
                        </div>
                        <input 
                          type="range" min="10" max="28" step="1"
                          value={config.sidebarFontSizeZh}
                          onChange={(e) => updateConfig({ sidebarFontSizeZh: parseInt(e.target.value) })}
                          className="w-full h-2.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-200 font-bold flex items-center gap-2">
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                      Shadowing Settings
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-gray-400 text-sm">Auto-start play/record on enable</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.shadowingAutoStart} onChange={(e) => updateConfig({ shadowingAutoStart: e.target.checked })} />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                    </label>
                  </div>
                  
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-gray-400 text-sm">Floating UI</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.shadowingFloatingUI} onChange={(e) => updateConfig({ shadowingFloatingUI: e.target.checked })} />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                    </label>
                  </div>
                  
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-gray-400 text-sm">Auto-hide subtitles when shadowing</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.shadowingAutoHideSubs} onChange={(e) => updateConfig({ shadowingAutoHideSubs: e.target.checked })} />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shadowing Score Display Area */}
          {(isShadowing || shadowingResult || shadowingError || isShadowingWaitingPlay) && (
            <div className={config.shadowingFloatingUI 
              ? "fixed top-24 left-6 z-[9999] bg-black/80 p-6 rounded-2xl border border-gray-600/50 shadow-2xl backdrop-blur-md max-w-[800px] w-[80vw] cursor-move" 
              : "bg-gray-900/80 p-4 mb-4 rounded-xl border border-gray-700 shadow-inner shrink-0"}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-gray-400 font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                  Shadowing Result
                  {isShadowingWaitingPlay && <span className="text-[10px] bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded border border-yellow-800/50">Waiting to play...</span>}
                  {isShadowing && <span className="text-[10px] bg-red-900/60 text-red-300 px-2 py-0.5 rounded border border-red-800/50">Recording...</span>}
                </span>
                {shadowingScore !== null && !isShadowing && !isShadowingComplete && (
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-base font-bold px-3 py-1 rounded-lg ${
                      shadowingScore >= 80 ? 'bg-green-900/50 text-green-400 border border-green-800' :
                      shadowingScore >= 50 ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-800' :
                      'bg-red-900/50 text-red-400 border border-red-800'
                    }`}>
                      Score: {shadowingScore}%
                    </span>
                    {shadowingComment && (
                      <span className={`text-[11px] px-2 py-0.5 rounded shadow-sm font-medium ${
                        shadowingScore >= 80 ? 'bg-green-800/30 text-green-300' :
                        shadowingScore >= 50 ? 'bg-yellow-800/30 text-yellow-300' :
                        'bg-red-800/30 text-red-300'
                      }`}>
                        {shadowingComment}
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {(isShadowing || isShadowingWaitingPlay) && (
                <div className="text-sm text-yellow-500/80 italic mb-2">
                  For best results, please wear headphones. Target: {abModeActive && abStart !== null ? "A-B Segment" : "Full Video"}
                </div>
              )}
              
              {shadowingError && (
                <div className="text-sm text-red-400 bg-red-900/20 p-3 rounded border border-red-900/50 mt-2">
                  {shadowingError}
                </div>
              )}
              
              {shadowingResult && (
                <div className="mt-4 space-y-2">
                  <div>
                    <span className="text-gray-500 text-[10px] uppercase block mb-1 font-bold tracking-wider">Your Speech:</span>
                    <div className="space-y-1.5 p-3 bg-gray-800/60 rounded-lg border border-gray-700 max-h-[40vh] overflow-y-auto">
                      {shadowingResult.split('|||').filter(Boolean).map((line, i) => (
                        <p key={i} className={`text-gray-300 ${config.shadowingFloatingUI ? 'text-lg leading-relaxed' : 'text-sm'}`}>
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar"
          >
            {loading && <p className="text-gray-400 text-center py-8">Loading subtitles...</p>}
            {errorMsg && <p className="text-red-400 p-3 bg-red-900/30 border border-red-800 rounded">{errorMsg}</p>}
            {!loading && !errorMsg && subtitles.length === 0 && (
              <p className="text-gray-400 text-center py-8">No subtitles found for this video.</p>
            )}
            
            {((isShadowing || isShadowingWaitingPlay) && config.shadowingAutoHideSubs) ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-gray-500 space-y-4">
                <svg className="w-12 h-12 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                <p>Subtitles are hidden during Shadowing mode.</p>
              </div>
            ) : (
              subtitles.map((sub, idx) => {
                const isActive = currentTime >= sub.start && currentTime < (sub.start + sub.duration);
                
                let isAbHighlighted = false;
                if (abModeActive) {
                  if (abStart !== null && abEnd !== null) {
                    isAbHighlighted = idx >= abStart && idx <= abEnd;
                  } else if (abStart !== null) {
                    isAbHighlighted = idx === abStart;
                  }
                }

                return (
                  <div 
                    key={idx} 
                    ref={isActive ? activeSubtitleRef : null}
                    onClick={() => handleSubtitleClick(idx, sub.start)}
                    className={`flex gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                      isActive && isAbHighlighted
                        ? "bg-blue-800/60 shadow-lg scale-[1.02] border border-blue-400"
                        : isActive 
                        ? "bg-gray-800/80 shadow-lg scale-[1.02] border border-gray-700" 
                        : isAbHighlighted
                        ? "bg-blue-900/30 border border-blue-500/50 opacity-90"
                        : "hover:bg-gray-800/40 opacity-70 hover:opacity-100 border border-transparent"
                    }`}
                  >
                    <div className={`font-mono mt-1 ${isActive ? "text-yellow-500 font-bold" : "text-gray-500"}`} style={{ fontSize: '13px' }}>
                      {formatTime(sub.start)}
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {config.showEn && (
                        <p className={`font-medium leading-relaxed ${isActive ? "text-yellow-400" : "text-gray-300"}`} style={{ fontSize: `${config.sidebarFontSizeEn}px` }}>
                          {sub.en.split(' ').map((word, wIdx) => (
                            <span 
                              key={wIdx} 
                              onClick={(e) => handleWordClick(e, word)}
                              className={`rounded px-[2px] transition-colors ${isActive ? "hover:bg-yellow-500/20" : "hover:bg-gray-700"}`}
                            >
                              {word}{" "}
                            </span>
                          ))}
                        </p>
                      )}
                      {config.showZh && (
                        <p className={`${isActive ? "text-gray-300" : "text-gray-500"}`} style={{ fontSize: `${config.sidebarFontSizeZh}px` }}>
                          {sub.zh}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {tooltip && (
            <div 
              className="absolute z-[10000] bg-gray-800 p-4 rounded-lg shadow-2xl border border-gray-700 max-w-[320px]"
              style={{ 
                top: tooltip.y, 
                left: tooltip.x > window.innerWidth / 2 ? tooltip.x - 320 : tooltip.x + 20 
              }}
            >
              <div className="flex justify-between items-start mb-2 border-b border-gray-700 pb-2">
                <strong className="text-blue-400 text-lg capitalize">{tooltip.word}</strong>
                <button 
                  onClick={() => setTooltip(null)}
                  className="text-gray-500 hover:text-gray-300 ml-4"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="text-sm text-gray-200">
                {tooltip.loading ? (
                  <div className="flex items-center gap-2 text-gray-400 py-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Searching dictionary...</span>
                  </div>
                ) : (
                  <div className="py-1 whitespace-pre-wrap leading-relaxed">{tooltip.definition}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

function init() {
  const existingContainer = document.getElementById("yt-lang-learn-root");
  if (existingContainer) return;

  const container = document.createElement("div");
  container.id = "yt-lang-learn-root";
  document.body.appendChild(container);

  // Use Shadow DOM to protect styles from YouTube's CSS
  const shadowRoot = container.attachShadow({ mode: "open" });

  // Create a style element for Tailwind CSS
  const style = document.createElement('style');
  style.textContent = tailwindCss;
  
  // Custom scrollbar styles for the sidebar
  const customScrollStyle = document.createElement('style');
  customScrollStyle.textContent = `
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: #374151;
      border-radius: 20px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: #4B5563;
    }
  `;

  const rootElement = document.createElement("div");
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(customScrollStyle);
  shadowRoot.appendChild(rootElement);

  const root = createRoot(rootElement);
  root.render(<ContentApp />);
}

// Ensure it runs after the DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
