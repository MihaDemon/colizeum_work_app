import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { request } from "../lib/api";

/** Protected evidence is fetched with the API token, never exposed as a public media URL. */
export function PrivateImage({
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolved, setResolved] = useState("");
  const [failed, setFailed] = useState(false);
  const privateFile = src?.startsWith("/api/files/");
  useEffect(() => {
    if (!src || !privateFile) return;
    const controller = new AbortController();
    let objectUrl = "";
    setFailed(false);
    setResolved("");
    request<Blob>(src, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, privateFile]);
  if (privateFile && !resolved)
    return (
      <span role="status">
        {failed
          ? "Photo could not be loaded. Reopen this view to retry."
          : "Loading photo…"}
      </span>
    );
  return (
    <img
      {...props}
      src={privateFile ? resolved : src}
      alt={alt}
      loading="lazy"
    />
  );
}
