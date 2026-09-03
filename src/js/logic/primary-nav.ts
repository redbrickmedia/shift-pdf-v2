const FILE_NAV_KEYS: Record<string, string> = {
  'index.html': 'my-pdfs',
  '': 'my-pdfs',
  'my-pdfs.html': 'my-pdfs',
  'all-tools.html': 'home',
  'compress-pdf.html': 'compress',
  'merge-pdf.html': 'merge',
  'pdf-converter.html': 'convert',
  'sign-pdf.html': 'esign',
};

const CLEAN_NAV_KEYS: Record<string, string> = {
  index: 'my-pdfs',
  'my-pdfs': 'my-pdfs',
  'all-tools': 'home',
  'compress-pdf': 'compress',
  'merge-pdf': 'merge',
  'pdf-converter': 'convert',
  'sign-pdf': 'esign',
};

export function primaryNavKeyFromPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  const file = path.split('/').pop() || 'index.html';
  return (
    FILE_NAV_KEYS[file] || CLEAN_NAV_KEYS[file.replace(/\.html$/, '')] || ''
  );
}
