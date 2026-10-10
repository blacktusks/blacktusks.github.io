import numpy as np, zlib, json, cv2, gc
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
info=json.load(open('raw/heights_info.json'))
X0,X1,Y0,Y1=info['x0'],info['x1'],info['y0'],info['y1']; NX,NY=X1-X0,Y1-Y0
W,H=info['w'],info['h']
h=np.frombuffer(zlib.decompress(open('raw/heights_i16.bin.z','rb').read()),dtype='<i2').reshape(H,W).astype(np.float32)
missing=(h==-32768); h*=8.0; h[missing]=info['default_land']; del missing
wc=np.frombuffer(open('raw/water_f32.bin','rb').read(),dtype='<f4').reshape(NY,NX).copy()
wc[np.isnan(wc)]=info['default_water']; wc[np.abs(wc)>1e6]=info['default_water']
h=np.ascontiguousarray(h[::-1]); wc=np.ascontiguousarray(wc[::-1])   # north up
np.save('heights_grid.npy',h)   # 32 samples per cell, north-up
PX=64; OW,OH=NX*PX,NY*PX
full=Image.open('map_full_noflip.png').convert('RGB')
cx=(X0+96)*PX; cy=(64-Y1)*PX
tex_all=np.asarray(full.crop((cx,cy,cx+OW,cy+OH))); del full; gc.collect()
out=np.empty((OH,OW,3),np.uint8)
unit=4096.0/PX; zf=1.6
az=np.radians(315); alt=np.radians(42)
lx,ly,lz=np.sin(az)*np.cos(alt),np.cos(az)*np.cos(alt),np.sin(alt)
deep=np.array([0.050,0.118,0.178],np.float32); shallow=np.array([0.165,0.320,0.375],np.float32)
# big-scale blur for ambient term, computed at grid res then upsampled per strip
big_grid=cv2.GaussianBlur(h,(0,0),12)
STRIP=784; HALO=32   # in output px; multiples of 2
for y0 in range(0,OH,STRIP):
    y1=min(OH,y0+STRIP)
    a0=max(0,y0-HALO); a1=min(OH,y1+HALO)
    g0,g1=a0//2,a1//2+1
    hi=cv2.resize(h[g0:g1+1],(OW,(g1+1-g0)*2),interpolation=cv2.INTER_CUBIC)
    off=a0-g0*2
    hi=hi[off:off+(a1-a0)]
    bg=cv2.resize(big_grid[g0:g1+1],(OW,(g1+1-g0)*2),interpolation=cv2.INTER_LINEAR)[off:off+(a1-a0)]
    hs=cv2.GaussianBlur(hi,(0,0),1.2)
    gy,gx=np.gradient(hs,unit); del hs
    nx_=-gx*zf; ny_=gy*zf; del gx,gy
    n=np.sqrt(nx_*nx_+ny_*ny_+1.0)
    shade=(nx_*lx+ny_*ly+lz)/n; del nx_,ny_,n
    rel=np.clip(shade/np.sin(alt),0.22,1.6); del shade
    ao=np.clip(1.0+(hi-bg)/9000.0,0.80,1.12); del bg
    s=slice(y0-a0,y0-a0+(y1-y0))
    tex=tex_all[y0:y1].astype(np.float32)/255.0
    lit=tex*((0.28+0.72*rel[s])*ao[s])[...,None]; del tex,rel,ao
    wl=np.repeat(np.repeat(wc[y0//PX:(y1-1)//PX+1],PX,axis=0),PX,axis=1)[(y0%PX):(y0%PX)+(y1-y0)]
    hh=hi[s]
    depth=np.clip((wl-hh)/1800.0,0,1)
    wmask=cv2.GaussianBlur((hh<wl-8).astype(np.float32),(0,0),1.0)
    wcol=shallow[None,None,:]*(1-depth[...,None])+deep[None,None,:]*depth[...,None]
    a=(wmask*(0.72+0.26*depth))[...,None]
    o=np.clip(lit*(1-a)+wcol*a,0,1)**0.94
    out[y0:y1]=(o*255+0.5).astype(np.uint8)
    del hi,lit,wl,depth,wmask,wcol,a,o; gc.collect()
img=Image.fromarray(out)
img.save('map_shaded.png',compress_level=1)
img.resize((OW//5,OH//5),Image.LANCZOS).save('map_shaded_preview.jpg',quality=88)
json.dump({'x0':X0,'x1':X1,'y0':Y0,'y1':Y1,'px_per_cell':PX,'w':OW,'h':OH},open('map_geo.json','w'))
print('saved',OW,OH)
