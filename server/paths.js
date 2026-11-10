import path from 'node:path';
import { realpath } from 'node:fs/promises';

export const photosLibraryMessage='系统「照片」图库不能作为照片来源，请先导出未经修改的原片到普通文件夹';
export const isPhotosLibraryPath=file=>path.resolve(file).split(path.sep).some(part=>part.toLowerCase().endsWith('.photoslibrary'));
export const samePath=(left,right)=>path.relative(path.resolve(left),path.resolve(right))==='';
export const isForeignWindowsPath=file=>path.win32.isAbsolute(file)&&!path.isAbsolute(file);
export function assertOutsidePhotosLibrary(file){
  if(isPhotosLibraryPath(file))throw Object.assign(new Error(photosLibraryMessage),{status:400});
}

export function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function resolveInside(root, relative) {
  if (!relative || path.isAbsolute(relative)) throw new Error('非法文件路径');
  const target = path.resolve(root, relative);
  if (!isInside(path.resolve(root), target)) throw new Error('文件超出照片目录');
  assertOutsidePhotosLibrary(root);assertOutsidePhotosLibrary(target);
  const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
  assertOutsidePhotosLibrary(actualRoot);assertOutsidePhotosLibrary(actualTarget);
  if(path.relative(path.resolve(root),actualRoot)!=='')throw Object.assign(new Error('照片目录位置已变化，请在设置中重新定位'),{status:503});
  if (!isInside(actualRoot, actualTarget)) throw new Error('文件超出照片目录');
  return actualTarget;
}
