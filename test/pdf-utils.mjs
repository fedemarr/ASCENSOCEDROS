import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {fileURLToPath} from 'node:url';
export async function readPdf(bytes) {
  const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/'),useSystemFonts:true});const doc=await task.promise;
  try {const pages=[];for(let i=1;i<=doc.numPages;i++)pages.push((await (await doc.getPage(i)).getTextContent()).items.map(item=>item.str).join(' '));return pages;}
  finally {await task.destroy();}
}
