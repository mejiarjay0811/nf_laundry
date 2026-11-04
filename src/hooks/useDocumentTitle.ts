import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? title + ' · N & F Laundry POS' : 'N & F Laundry POS';
    return () => {
      document.title = previous;
    };
  }, [title]);
}
