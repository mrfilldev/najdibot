import parselmouth, sys
from parselmouth.praat import call
src, dst, f0 = sys.argv[1], sys.argv[2], float(sys.argv[3])
snd = parselmouth.Sound(src)
# формант-сдвиг 1.0 = мужской тембр сохраняется, меняется только высота; интонация (диапазон) не трогаем
out = call(snd, "Change gender", 60, 400, 1.0, f0, 1.0, 1.0)
out.save(dst, "WAV")
