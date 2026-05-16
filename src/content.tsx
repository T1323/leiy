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

const ContentApp = () => {
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopActive, setLoopActive] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const currentSubtitleRef = useRef<Subtitle | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSubtitleRef = useRef<HTMLDivElement>(null);

  // Update currentSubtitleRef when currentTime or subtitles change
  useEffect(() => {
    const active = subtitles.find(s => currentTime >= s.start && currentTime < (s.start + s.duration));
    currentSubtitleRef.current = active || null;
  }, [currentTime, subtitles]);

  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      if (e.source === window && e.data && e.data.type === 'YT_CAPTIONS_INTERCEPT') {
        const { url, data } = e.data;
        if (!data || !data.events || data.events.length === 0) {
           setErrorMsg("Intercepted captions are empty.");
           return;
        }
        setLoading(true);
        setErrorMsg(null);
        try {
          const subs = await processInterceptedCaptions(url, data);
          if (subs.length === 0) {
            setErrorMsg(`Failed to parse intercepted subtitles.`);
          }
          setSubtitles(subs);
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
      
      if (loopActive && currentSubtitleRef.current) {
        const sub = currentSubtitleRef.current;
        if (video.currentTime >= sub.start + sub.duration) {
          video.currentTime = sub.start;
        }
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [loopActive]);

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

  const handleSubtitleClick = (start: number) => {
    const video = document.querySelector("video");
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
    // Assuming tooltip will be absolute within the container
    const containerRect = scrollContainerRef.current?.parentElement?.getBoundingClientRect() || { top: 0, left: 0 };
    
    setTooltip({
      word: cleanWord,
      definition: null,
      loading: true,
      x: rect.left - containerRect.left,
      y: Math.max(0, rect.top - containerRect.top - 100) // placing it slightly above
    });

    try {
      const response = await chrome.runtime.sendMessage({ action: "LOOKUP_WORD", word: cleanWord });
      setTooltip(prev => prev ? { ...prev, definition: response.definition, loading: false } : null);
    } catch (error) {
      setTooltip(prev => prev ? { ...prev, definition: "Definition not found.", loading: false } : null);
    }
  };

  return (
    <div className="w-[450px] h-[600px] bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-y-auto p-4 absolute top-16 right-4 z-[9999] border border-gray-200 flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">YT Language Learn</h2>
        <button
          onClick={() => setLoopActive(!loopActive)}
          className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
            loopActive 
              ? "bg-green-500 text-white" 
              : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          }`}
        >
          {loopActive ? "Loop: ON" : "Loop: OFF"}
        </button>
      </div>
      
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto pr-2 space-y-4"
      >
        {loading && <p className="text-gray-500">Loading subtitles...</p>}
        {errorMsg && <p className="text-red-500 p-2 bg-red-100 rounded">{errorMsg}</p>}
        {!loading && !errorMsg && subtitles.length === 0 && (
          <p className="text-gray-500">No subtitles found for this video.</p>
        )}
        {subtitles.map((sub, idx) => {
          const isActive = currentTime >= sub.start && currentTime < (sub.start + sub.duration);
          return (
            <div 
              key={idx} 
              ref={isActive ? activeSubtitleRef : null}
              onClick={() => handleSubtitleClick(sub.start)}
              className={`p-2 rounded cursor-pointer transition-colors ${
                isActive 
                  ? "bg-blue-100 dark:bg-blue-900 border-l-4 border-blue-500" 
                  : "hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <p className={`text-sm font-semibold leading-relaxed ${isActive ? "text-blue-900 dark:text-blue-100" : "text-gray-800 dark:text-gray-200"}`}>
                {sub.en.split(' ').map((word, wIdx) => (
                  <span 
                    key={wIdx} 
                    onClick={(e) => handleWordClick(e, word)}
                    className="hover:bg-yellow-200 dark:hover:bg-yellow-600 rounded px-[2px] transition-colors"
                  >
                    {word}{" "}
                  </span>
                ))}
              </p>
              <p className={`text-sm mt-1 ${isActive ? "text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-400"}`}>
                {sub.zh}
              </p>
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div 
          className="absolute z-50 bg-white dark:bg-gray-700 p-3 rounded-md shadow-xl border border-gray-200 dark:border-gray-600 max-w-[300px]"
          style={{ top: tooltip.y, left: tooltip.x > 150 ? tooltip.x - 100 : tooltip.x }}
        >
          <div className="flex justify-between items-center mb-1">
            <strong className="text-blue-600 dark:text-blue-400">{tooltip.word}</strong>
            <button 
              onClick={() => setTooltip(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {tooltip.loading ? (
              <span className="italic">Loading...</span>
            ) : (
              <span>{tooltip.definition}</span>
            )}
          </div>
        </div>
      )}
    </div>
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
  
  const rootElement = document.createElement("div");
  shadowRoot.appendChild(style);
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
