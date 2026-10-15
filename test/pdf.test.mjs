import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGuestPdf} from '../cloud/guest-pdf.mjs';
import {readPdf} from './pdf-utils.mjs';
const event={title:'LOS CEDROS NIGHT',date:'2026-10-17',location:'Los Cedros Rugby Club'};
test('PDF: lista extensa, caracteres españoles, títulos repetidos y páginas numeradas',async()=>{
  const guests=Array.from({length:73},(_,i)=>({first_name:'Lucía',last_name:'Gómez '+String(i+1).padStart(3,'0')+(i===25 ? ' Apellido compuesto muy largo para verificar que el texto se ajuste' : ''),dni:String(60000000+i),inviter_name:'Federico Martínez',gender:i%2 ? 'male':'female',inviter_active:1,revoked:0,created_at:'2026-10-15T13:00:00Z',entered_at:i===1 ? '2026-10-17T04:00:00Z':null}));
  const bytes=await createGuestPdf({guests,event,filters:new URLSearchParams('sort=oldest')});
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const pages=await readPdf(bytes);assert.ok(pages.length>2);
  pages.forEach((text,i)=>{assert.match(text,/LISTA DE INVITADOS/);assert.match(text,/NOMBRE Y APELLIDO/);assert.match(text,new RegExp('Página '+(i+1)+' de '+pages.length));});
  const text=pages.join(' ');for(let i=1;i<=73;i++)assert.ok(text.includes('Gómez '+String(i).padStart(3,'0')));
  assert.match(text,/Federico Martínez/);assert.match(text,/Ingresó/);assert.match(text,/73 personas/);
});
test('PDF: lista vacía con filtros sin porcentajes inválidos',async()=>{
  const pages=await readPdf(await createGuestPdf({guests:[],event,filters:new URLSearchParams('gender=female&state=entered')}));
  assert.equal(pages.length,1);assert.match(pages[0],/No hay invitados/);assert.match(pages[0],/Género: Mujeres/);assert.doesNotMatch(pages[0],/NaN|Infinity/);
});
