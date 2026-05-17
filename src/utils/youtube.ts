export interface Subtitle {
  start: number;
  duration: number;
  en: string;
  zh: string;
}

export interface ProcessedCaptions {
  source: 'native' | 'api';
  subtitles: Subtitle[];
}

export async function processInterceptedCaptions(url: string, enData: any, captionTracks?: any[]): Promise<ProcessedCaptions> {
  try {
    if (!enData.events || enData.events.length === 0) {
      throw new Error(`enData.events empty. URL: ${url}`);
    }

    // Step 1: Check for native Chinese track
    let nativeZhTrackUrl = null;
    if (captionTracks && Array.isArray(captionTracks)) {
      const zhTrack = captionTracks.find(t => t.languageCode && t.languageCode.startsWith('zh'));
      if (zhTrack && zhTrack.baseUrl) {
        nativeZhTrackUrl = zhTrack.baseUrl;
        // Ensure format is JSON3
        if (!nativeZhTrackUrl.includes('fmt=json3')) {
          nativeZhTrackUrl += '&fmt=json3';
        }
      }
    }

    const enEvents = enData.events || [];
    const rawSubtitles: Subtitle[] = [];
    let translationSource: 'native' | 'api' = 'api';

    if (nativeZhTrackUrl) {
      console.log("YT Lang Learn: Native Chinese track found and used.");
      translationSource = 'native';
      // Fetch Native Track
      let zhEvents: any[] = [];
      try {
        const zhRes = await fetch(nativeZhTrackUrl);
        if (zhRes.ok) {
          const zhData = await zhRes.json();
          zhEvents = zhData.events || [];
        }
      } catch (e) {
        console.error("YT Lang Learn: Failed to fetch native Chinese track", e);
      }

      // Synchronize native Chinese track with English track
      // Iterate English events and find overlapping Chinese events
      for (let i = 0; i < enEvents.length; i++) {
        const enEvent = enEvents[i];
        if (!enEvent.segs) continue;

        const start = enEvent.tStartMs / 1000;
        const duration = (enEvent.dDurationMs || 0) / 1000;
        const end = start + duration;
        const enText = enEvent.segs.map((s: any) => s.utf8).join('').trim();
        
        if (enText.trim() === '') continue;

        let matchedZhText = '';
        // Find all Chinese events that overlap with this English event
        // We use midpoint overlap or just any overlap
        const midpoint = start + duration / 2;
        
        // Let's find the Chinese event whose time span covers the midpoint, or just overlaps mostly
        const overlappingZh = zhEvents.filter(zhEvent => {
          if (!zhEvent.segs) return false;
          const zStart = zhEvent.tStartMs / 1000;
          const zDuration = (zhEvent.dDurationMs || 0) / 1000;
          const zEnd = zStart + zDuration;
          return (midpoint >= zStart && midpoint <= zEnd);
        });

        // If none overlap the midpoint, find any that overlap
        if (overlappingZh.length === 0) {
           const anyOverlap = zhEvents.filter(zhEvent => {
              if (!zhEvent.segs) return false;
              const zStart = zhEvent.tStartMs / 1000;
              const zDuration = (zhEvent.dDurationMs || 0) / 1000;
              const zEnd = zStart + zDuration;
              return Math.max(start, zStart) < Math.min(end, zEnd);
           });
           if (anyOverlap.length > 0) {
             matchedZhText = anyOverlap.map(z => z.segs.map((s: any) => s.utf8).join('').trim()).join(' ');
           }
        } else {
          matchedZhText = overlappingZh.map(z => z.segs.map((s: any) => s.utf8).join('').trim()).join(' ');
        }

        rawSubtitles.push({ start, duration, en: enText, zh: matchedZhText });
      }

    } else {
      console.log("YT Lang Learn: No native Chinese track found. Using API translation fallback.");
      // Fallback: Translate sentence-by-sentence
      
      const enTexts: string[] = [];
      const validEvents: any[] = [];
      
      for (let i = 0; i < enEvents.length; i++) {
        const enEvent = enEvents[i];
        if (!enEvent.segs) continue;
        const enText = enEvent.segs.map((s: any) => s.utf8).join('').trim();
        if (enText.trim() === '') continue;
        
        enTexts.push(enText);
        validEvents.push(enEvent);
      }

      // Call Background Script to translate
      let translatedTexts: string[] = [];
      try {
        const response = await chrome.runtime.sendMessage({ action: "TRANSLATE_BATCH", texts: enTexts });
        translatedTexts = response?.translatedTexts || [];
      } catch (e) {
        console.error("YT Lang Learn: Fallback API Translation Error", e);
      }

      // Map back exactly 1:1
      for (let i = 0; i < validEvents.length; i++) {
        const enEvent = validEvents[i];
        const start = enEvent.tStartMs / 1000;
        const duration = (enEvent.dDurationMs || 0) / 1000;
        const enText = enTexts[i];
        const zhText = translatedTexts[i] || '';

        rawSubtitles.push({ start, duration, en: enText, zh: zhText });
      }
    }

    // Merge fragmented subtitles to fix YouTube auto-translate sync issues
    const subtitles: Subtitle[] = [];
    let pending: Subtitle | null = null;

    const isZhFragment = (zh: string) => {
      // Consider it a fragment if it's empty or has very few actual characters
      const clean = zh.replace(/[.,!?。，！？、\s]/g, '');
      return clean.length < 3;
    };

    for (const sub of rawSubtitles) {
      if (!pending) {
        pending = { ...sub };
      } else {
        // Merge if current pending zh is a fragment AND we haven't merged too much text
        if (isZhFragment(pending.zh) && pending.en.length < 150) {
          pending.en += (pending.en ? ' ' : '') + sub.en;
          pending.zh += sub.zh; 
          // Update duration to cover the merged subtitle
          const newEnd = Math.max(pending.start + pending.duration, sub.start + sub.duration);
          pending.duration = newEnd - pending.start;
        } else {
          subtitles.push(pending);
          pending = { ...sub };
        }
      }
    }
    if (pending) {
      subtitles.push(pending);
    }

    // Ensure subtitles are sorted by start time
    subtitles.sort((a, b) => a.start - b.start);

    // Fix overlapping durations to ensure only one subtitle is active at a time
    for (let i = 0; i < subtitles.length - 1; i++) {
      const current = subtitles[i];
      const next = subtitles[i + 1];
      if (current.start + current.duration > next.start) {
        current.duration = Math.max(0, next.start - current.start);
      }
    }

    return { source: translationSource, subtitles };
  } catch (error: any) {
    throw new Error(`Subtitle Parsing Error: ${error.message}`);
  }
}
