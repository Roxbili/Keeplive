import { parentPort,workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import convert from 'heic-convert';

try{
  let input=await readFile(workerData.input);
  if(/\.(heic|heif)$/i.test(workerData.input))input=Buffer.from(await convert({buffer:input,format:'JPEG',quality:0.95}));
  await sharp(input,{limitInputPixels:120_000_000}).rotate().resize({width:workerData.size,height:workerData.size,fit:'inside',withoutEnlargement:true}).jpeg({quality:workerData.size===480?78:90}).toFile(workerData.output);
  parentPort.postMessage({ok:true});
}catch(error){parentPort.postMessage({error:error.message});}
