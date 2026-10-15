import { PDFDocument } from 'pdfkit';
import { genderStats } from './demographics.mjs';

const labels={female:'Mujeres',male:'Hombres',other:'Otro',unknown:'Sin dato'};
const genderLabel={female:'Mujer',male:'Hombre',other:'Otro',unknown:'Sin dato'};
const states={all:'Todos',pending:'Por ingresar',entered:'Ingresaron',revoked:'Revocados'};
const orders={oldest:'Inscripción: primeros a últimos',newest:'Inscripción: últimos a primeros',name:'Apellido y nombre'};
const safe=value=>String(value ?? '').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const dateTime=value=>value ? new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Buenos_Aires'}).format(new Date(value)) : '-';

export async function createGuestPdf({guests,event,filters=new URLSearchParams(),inviterName='',generatedAt=new Date()}) {
  const doc=new PDFDocument({size:'A4',layout:'landscape',margins:{top:36,bottom:20,left:36,right:36},bufferPages:true,info:{Title:'Los Cedros Night - Lista de invitados',Author:'Los Cedros Rugby Club'}});
  const chunks=[];
  const complete=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const left=36, width=doc.page.width-72;
  const columns=[['N°',28],['NOMBRE Y APELLIDO',185],['DNI',78],['INVITADO POR',150],['GÉNERO',65],['ESTADO / INGRESO',120],['INSCRIPCIÓN',width-626]];
  const stats=genderStats(Object.entries(guests.reduce((counts,g)=>(counts[g.gender || 'unknown']=(counts[g.gender || 'unknown'] || 0)+1,counts),{})).map(([gender,count])=>({gender,count})));
  const criteria=[];
  if(filters.get('q')) criteria.push('Búsqueda: '+safe(filters.get('q')));
  if(inviterName || filters.get('inviter_name')) criteria.push('Invitador: '+safe(inviterName || filters.get('inviter_name')));
  criteria.push('Género: '+(labels[filters.get('gender')] || 'Todos'));
  criteria.push('Estado: '+(states[filters.get('state')] || 'Todos'));
  criteria.push(orders[filters.get('sort')] || orders.oldest);
  let y;
  const header=()=>{
    doc.rect(0,0,doc.page.width,7).fill('#f4dc36');
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#10294b').text('LISTA DE INVITADOS',left,28,{width:450});
    doc.fontSize(9).text('LOS CEDROS / NIGHT',doc.page.width-236,34,{width:200,align:'right'});
    doc.font('Helvetica').fontSize(9).fillColor('#45556a').text(safe(event.title)+' | '+(event.date ? event.date.split('-').reverse().join('/') : 'Fecha a confirmar')+' | '+safe(event.location),left,57,{width});
    y=doc.y+7;
    doc.text('Generado: '+dateTime(generatedAt)+' (Argentina) | '+guests.length+(guests.length===1 ? ' persona' : ' personas')+' en esta lista',left,y,{width});y=doc.y+7;
    doc.fontSize(8).text(criteria.join(' | '),left,y,{width});y=doc.y+7;
    doc.font('Helvetica-Bold').fillColor('#10294b').text(stats.categories.map(c=>`${labels[c.gender]}: ${c.count} (${String(c.percentage).replace('.',',')}%)`).join('   |   '),left,y,{width});y=doc.y+5;
    doc.font('Helvetica').fontSize(7).fillColor('#637084').text('Porcentajes sobre esta lista filtrada. Los redondeos pueden sumar 99,9% o 100,1%.',left,y,{width});y=doc.y+12;
    doc.rect(left,y,width,25).fill('#10294b');let x=left;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('white');
    for(const [label,w] of columns){doc.text(label,x+6,y+9,{width:w-12,lineBreak:false});x+=w;}
    y+=25;
  };
  header();
  if(!guests.length){doc.font('Helvetica').fontSize(12).fillColor('#45556a').text('No hay invitados con estos filtros.',left,y+24,{width});}
  guests.forEach((g,index)=>{
    const revoked=g.revoked || !g.inviter_active;
    const status=revoked ? 'Revocado' : g.entered_at ? 'Ingresó' : 'Por ingresar';
    const cells=[String(index+1),safe(g.first_name)+' '+safe(g.last_name),safe(g.dni),safe(g.inviter_name),genderLabel[g.gender] || 'Sin dato',status+(g.entered_at ? '\n'+dateTime(g.entered_at) : ''),dateTime(g.created_at)];
    doc.font('Helvetica').fontSize(8.5);
    const height=Math.max(30,...cells.map((cell,i)=>doc.font(i===1 ? 'Helvetica-Bold' : 'Helvetica').heightOfString(cell,{width:columns[i][1]-12,lineGap:1})+14));
    if(y+height>doc.page.height-52){doc.addPage();header();}
    if(index%2===0)doc.rect(left,y,width,height).fill('#f1f5fb');
    let x=left;
    cells.forEach((cell,i)=>{doc.font(i===1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#172c47').text(cell,x+6,y+7,{width:columns[i][1]-12,lineGap:1});x+=columns[i][1];});
    doc.moveTo(left,y+height).lineTo(left+width,y+height).strokeColor('#e2e8f0').lineWidth(.4).stroke();y+=height;
  });
  const pages=doc.bufferedPageRange().count;
  for(let page=0;page<pages;page++){
    doc.switchToPage(page);const footerY=doc.page.height-34;
    doc.font('Helvetica').fontSize(8).fillColor('#637084').text('Los Cedros Rugby Club | Uso interno - Lista al momento de exportar',left,footerY,{width:width-100,lineBreak:false});
    doc.text(`Página ${page+1} de ${pages}`,left+width-100,footerY,{width:100,align:'right',lineBreak:false});
  }
  doc.end();return complete;
}
