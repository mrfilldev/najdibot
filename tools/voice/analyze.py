import parselmouth, numpy as np, sys
def stats(path):
    s = parselmouth.Sound(path)
    pitch = s.to_pitch(pitch_floor=70, pitch_ceiling=400)
    f0 = pitch.selected_array['frequency']; f0 = f0[f0>0]
    inten = s.to_intensity()
    form = s.to_formant_burg(max_number_of_formants=5, maximum_formant=5500)
    t = np.arange(0.1, s.duration-0.1, 0.05)
    f1=[form.get_value_at_time(1,x) for x in t]; f2=[form.get_value_at_time(2,x) for x in t]
    f1=[v for v in f1 if v==v]; f2=[v for v in f2 if v==v]
    voiced = len(f0)/len(pitch.selected_array['frequency'])
    # темп: пики интенсивности как грубая оценка слогов
    ii = inten.values[0]; peaks = ((ii[1:-1]>ii[:-2])&(ii[1:-1]>ii[2:])&(ii[1:-1]>ii.max()-25)).sum()
    print(f"{path.split('/')[-1]}: dur={s.duration:.1f}s  F0 median={np.median(f0):.0f}Hz  p10-p90={np.percentile(f0,10):.0f}-{np.percentile(f0,90):.0f}Hz  F1~{np.median(f1):.0f} F2~{np.median(f2):.0f}  voiced={voiced:.0%}  peaks/s={peaks/s.duration:.1f}")
for p in sys.argv[1:]: stats(p)
