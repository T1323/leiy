export interface Subtitle {
  start: number;
  duration: number;
  en: string;
  zh: string;
}

export async function processInterceptedCaptions(url: string, enData: any): Promise<Subtitle[]> {
  try {
    if (!enData.events || enData.events.length === 0) {
      throw new Error(`enData.events empty. URL: ${url}`);
    }

    let zhFetchUrl = url;
    if (zhFetchUrl.includes('tlang=')) {
      zhFetchUrl = zhFetchUrl.replace(/tlang=[^&]+/, 'tlang=zh-Hant');
    } else {
      zhFetchUrl += '&tlang=zh-Hant';
    }

    // Fetch Chinese subtitles by translating the intercepted track
    // If it fails, we just don't have zh translation
    let zhData: any = { events: [] };
    try {
      const zhRes = await fetch(zhFetchUrl);
      if (zhRes.ok) {
        const zhTextRaw = await zhRes.text();
        // Simple check to ensure it's likely JSON before parsing
        if (zhTextRaw && zhTextRaw.trim().startsWith('{')) {
          zhData = JSON.parse(zhTextRaw);
        } else {
          console.log("YT Lang Learn: zh translation response is not JSON.");
        }
      } else {
        console.log("YT Lang Learn: zh translation fetch failed with status", zhRes.status);
      }
    } catch (e: any) {
      console.log("YT Lang Learn: Failed to fetch zh translation:", e.message);
    }

    const subtitles: Subtitle[] = [];
    const enEvents = enData.events || [];
    const zhEvents = zhData.events || [];

    for (let i = 0; i < enEvents.length; i++) {
      const enEvent = enEvents[i];
      const zhEvent = zhEvents[i];

      if (!enEvent.segs) continue;

      const start = enEvent.tStartMs / 1000;
      const duration = (enEvent.dDurationMs || 0) / 1000;
      
      const enText = enEvent.segs.map((s: any) => s.utf8).join('').trim();
      const zhText = zhEvent?.segs?.map((s: any) => s.utf8).join('').trim() || '';

      if (enText.trim() === '' && zhText.trim() === '') continue;

      subtitles.push({ start, duration, en: enText, zh: zhText });
    }

    return subtitles;
  } catch (error: any) {
    throw new Error(`Subtitle Parsing Error: ${error.message}`);
  }
}
