// safeFetch: wrap native fetch and handle AbortError gracefully
export async function safeFetch(input, init) {
  try {
    return await fetch(input, init);
  } catch (e) {
    try {
      if (e && e.name === 'AbortError') {
        // 返回一個最小 Response-like 物件，保證呼叫端的 resp.json()/resp.text() 不會拋錯
        console.debug('[safeFetch] request aborted:', input);
        return {
          ok: false,
          status: 0,
          aborted: true,
          text: async () => '',
          json: async () => ({}),
        };
      }
    } catch (ignore) {}
    throw e;
  }
}

export default safeFetch;
