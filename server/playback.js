export const defaultPlayback=Object.freeze({liveSound:true,videoSound:true,videoQuality:'original'});
export const isVideoQuality=value=>typeof value==='string'&&['original','high','smooth'].includes(value);
