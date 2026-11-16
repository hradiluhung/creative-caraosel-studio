import { useEffect, useState } from "react";

/** Object URL for a blob, revoked automatically when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Object URLs are an external resource with a create/revoke lifecycle, so they are
    // owned by this effect rather than derived during render.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
