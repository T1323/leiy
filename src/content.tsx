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
}

const DEFAULT_CONFIG: Config = {
  showEn: true,
  showZh: true,
  fontSizeEn: 36,
  fontSizeZh: 24,
  sidebarFontSizeEn: 16,
  sidebarFontSizeZh: 14,
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

  const currentSubtitleRef = useRef<Subtitle | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSubtitleRef = useRef<HTMLDivElement>(null);

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

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      if (abModeActive && abStart !== null && abEnd !== null) {
        const startSub = subtitles[abStart];
        const endSub = subtitles[abEnd];
        if (startSub && endSub) {
          const endTime = endSub.start + endSub.duration;
          const startTime = startSub.start;
          
          if (!video.paused && video.currentTime >= endTime && video.currentTime < endTime + 2) {
            video.pause();
            video.currentTime = startTime;
          }
        }
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [abModeActive, abStart, abEnd, subtitles]);

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
      } else if (abStart === null) {
        // First click
        setAbStart(idx);
      } else if (abStart !== null && abEnd === null) {
        // Second click
        if (idx < abStart) {
          // Clicked before start, update start, keep end null
          setAbStart(idx);
        } else {
          // Clicked after or equal to start, set end and play
          setAbEnd(idx);
          if (video) {
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

      {isVisible && currentSubtitleRef.current && (config.showEn || config.showZh) && (
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
              </div>
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
            {subtitles.map((sub, idx) => {
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
            })}
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
