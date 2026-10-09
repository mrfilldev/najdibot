import numpy as np, wave, sys
def load(p):
    w = wave.open(p); sr = w.getframerate(); n = w.getnframes()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32)/32768
    if w.getnchannels() > 1: x = x.reshape(-1, w.getnchannels()).mean(1)
    return x, sr
def ltas(x, sr, nfft=4096):
    win = np.hanning(nfft); acc = np.zeros(nfft//2+1); k = 0
    for i in range(0, len(x)-nfft, nfft//2):
        seg = x[i:i+nfft]
        if np.sqrt((seg**2).mean()) < 0.01: continue   # пропускаем паузы
        acc += np.abs(np.fft.rfft(seg*win))**2; k += 1
    return np.fft.rfftfreq(nfft, 1/sr), 10*np.log10(acc/max(k,1)+1e-12)
fo, lo = ltas(*load(sys.argv[1])); fm, lm = ltas(*load(sys.argv[2]))
centers = [80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000]
def band(f, l, c):
    m = (f >= c/2**(1/6)) & (f < c*2**(1/6)); return l[m].mean()
ent = []
for c in centers:
    g = band(fo, lo, c) - band(fm, lm, c)
    ent.append((c, g))
off = np.mean([g for _, g in ent]); ent = [(c, float(np.clip(g-off, -12, 12))) for c, g in ent]
print(" ".join(f"{c}:{g:+.0f}" for c, g in ent), file=sys.stderr)
print("entry(20,%.1f);" % ent[0][1] + ";".join(f"entry({c},{g:.1f})" for c, g in ent) + ";entry(11000,%.1f)" % ent[-1][1])
