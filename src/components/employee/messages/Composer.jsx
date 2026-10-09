"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { SmsCost } from "./SmsCost";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Re-broadcast "typing" at most this often — the idle timeout on the other
 * end (useTypingPresence) is longer than this, so a steady typist never
 * flickers between shown/hidden. */
const TYPING_BROADCAST_MS = 2000;

/**
 * Resize before upload. The photo rides into the server action as base64,
 * a third larger than the file, and a raw camera shot (3-5MB) blew past
 * Next's action body limit BEFORE our code ran: the failure was Next's own
 * anonymous "Something went wrong", with nothing in our logs. 1600px on the
 * long edge is plenty for a photo of a phone or a quote and lands a typical
 * shot at 200-400KB, which is also what carriers deliver without downscaling
 * it themselves. MAX_ENCODED_BYTES is the ceiling for what still goes up
 * (next.config raises the action limit to cover it): the odd huge PNG, or a
 * format the browser could not decode and so could not shrink.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_ENCODED_BYTES = 3 * 1024 * 1024;
/** Below this a decodable file is sent as picked; re-encoding gains nothing. */
const KEEP_AS_IS_BYTES = 600 * 1024;

/**
 * Message composer with optional image attachment. Reads the image to a base64
 * data URL client-side; the server action hosts it (live mode) before Twilio
 * fetches it. `onSend(text, image)` where image is { base64, mimeType } | null.
 */
export function Composer({ onSend, disabled, onTyping, onStoppedTyping }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState(null); // { dataUrl, base64, mimeType, name }
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const lastTypingSentAt = useRef(0);

  function handleTextChange(value) {
    setText(value);
    if (!onTyping) return;
    if (!value.trim()) {
      onStoppedTyping?.();
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_BROADCAST_MS) return;
    lastTypingSentAt.current = now;
    onTyping();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setError("Image is too large (8MB max).");
    setError("");
    try {
      const { dataUrl, mimeType } = await prepareImage(file);
      if (dataUrl.length > MAX_ENCODED_BYTES) {
        return setError("That image is still too large after resizing. Try a smaller one.");
      }
      setImage({ dataUrl, base64: dataUrl, mimeType, name: file.name });
    } catch {
      setError("That image couldn't be read. Try a JPEG or PNG.");
    }
  }

  async function send() {
    if ((!text.trim() && !image) || sending) return;
    setSending(true);
    setError("");
    try {
      await onSend(text.trim(), image ? { base64: image.base64, mimeType: image.mimeType } : null);
      setText("");
      setImage(null);
      onStoppedTyping?.();
    } catch (err) {
      setError(err?.message || "Couldn't send that message.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3.5">
      {image && (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt={image.name}
            className="block max-h-28 rounded-[10px] border-[1.5px] border-line"
          />
          <button
            onClick={() => setImage(null)}
            aria-label="Remove image"
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-ink text-white"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          type="file"
          accept="image/*"
          ref={fileRef}
          onChange={handleFile}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          title="Attach image"
          className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border-[1.5px] border-line bg-white text-muted hover:border-accent hover:text-accent"
        >
          <ImageIcon size={16} />
        </button>
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={() => onStoppedTyping?.()}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Write a message…"
          className="flex-1 resize-y rounded-lg border-[1.5px] border-line bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
        />
        <Button disabled={disabled || sending || (!text.trim() && !image)} onClick={send}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      <SmsCost text={text} />

      {error && (
        <div className="flex items-center gap-1.5 self-end text-[11.5px] text-red-500">
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </div>
  );
}

/**
 * Read a picked file as a data URL, resized and re-encoded as JPEG when it
 * is bigger than MAX_EDGE. Animated GIFs are kept as picked (a canvas keeps
 * only the first frame), and anything the browser cannot decode falls back
 * to the original bytes so an odd format still gets its chance server-side.
 */
async function prepareImage(file) {
  const original = await readAsDataUrl(file);
  const asPicked = { dataUrl: original, mimeType: file.type };
  if (file.type === "image/gif") return asPicked;

  let img;
  try {
    img = await loadImage(original);
  } catch {
    return asPicked;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) return asPicked;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha: a transparent PNG would otherwise come out on black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), mimeType: "image/jpeg" };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The browser could not decode this image."));
    img.src = src;
  });
}
