import path from 'node:path';
import { realpath } from 'node:fs/promises';

export function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function resolveInside(root, relative) {
  if (!relative || path.isAbsolute(relative)) throw new Error('非法文件路径');
  const target = path.resolve(root, relative);
  if (!isInside(path.resolve(root), target)) throw new Error('文件超出照片目录');
  const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
  if(path.relative(path.resolve(root),actualRoot)!=='')throw Object.assign(new Error('照片目录位置已变化，请在设置中重新定位'),{status:503});
  if (!isInside(actualRoot, actualTarget)) throw new Error('文件超出照片目录');
  return actualTarget;
}
