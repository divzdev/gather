/** Pre-paint session stamp, the same trick as `themeBootScript`.
 *
 *  The session lives in localStorage, which the server cannot read, so SSR has
 *  no choice but to render the signed-out entry links — and correcting that
 *  after hydration painted "Sign in" first and flipped it to "Console" a frame
 *  later. The wrong state must never paint: this runs in <head>, before first
 *  paint, and stamps which sessions exist on <html>. CSS picks the entry links
 *  from the stamp, so the first painted frame is already the right one.
 *
 *  The keys mirror lib/session.ts (`TOKEN_KEY`, `SPEAKER_KEY`). Spelled out as
 *  literals because this string must stay a self-contained inline script.
 *
 *  With JavaScript off the stamp is never written, and the CSS default shows
 *  the signed-out links — the only honest answer when nothing can read a token.
 */
export const authBootScript = `(()=>{try{
  var s=localStorage.getItem("gather.token")?1:0;
  var p=localStorage.getItem("gather.speaker")?1:0;
  document.documentElement.dataset.auth=s&&p?"both":s?"staff":p?"speaker":"none";
}catch(e){document.documentElement.dataset.auth="none"}})()`;
