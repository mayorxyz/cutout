import { useCallback, useRef } from 'react';

export function useImageFile(onSelectFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFilePicker = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onSelectFile(file);
      }
      event.target.value = '';
    },
    [onSelectFile]
  );

  return {
    inputRef,
    openFilePicker,
    handleInputChange,
  };
}
