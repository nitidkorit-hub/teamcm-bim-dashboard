# Structural Design App — Engineering Spec v1

## ⚠ OVERRIDE — verified law research (2026-10-25). Where this section conflicts with §1–§5 below, THIS SECTION WINS.
Source: gazette text of กฎกระทรวงกำหนดการออกแบบโครงสร้างอาคาร และลักษณะและคุณสมบัติของวัสดุที่ใช้ในงานโครงสร้างอาคาร พ.ศ. 2566
(ราชกิจจาฯ เล่ม 140 ตอนที่ 54 ก, 6 ก.ย. 2566; effective 4 มี.ค. 2567). It **repeals กฎกระทรวงฉบับที่ 6 (2527)**, ฉบับที่ 48 (2540), ฉบับที่ 60 (2549).
Transitional ข้อ 25: applications filed before 4 มี.ค. 2567 continue under ฉ.6.

**Combination sets** (ids): `MR2566` (DEFAULT, legal basis), `MR6_2527` (legacy, only for pre-2567 permits), `ACI318` (optional alternative
"generally accepted standard"; 1.4D, 1.2D+1.6L, 1.2D+1.0L+1.6W, 0.9D+1.6W, 1.2D+1.0L+1.0E, 0.9D+1.0E). Drop the old "Legacy/Current/Envelope" naming.
- MR2566 SDM (ข้อ 7): 1.4D+1.7L; 0.75(1.4D+1.7L)+1.6W; 0.9D+1.6W; 0.75(1.4D+1.7L)+1.0E; 0.9D+1.0E; 1.4D+1.7L+1.7H; 0.9D+1.7H;
  1.4D+1.7L+1.4F; 0.9D+1.4F; 0.75(1.4D+1.4T+1.7L); 1.4D+1.4T.
- MR2566 WSD/ASD (ข้อ 6): D+L; D+0.75(L+W); 0.6D+W; D+0.7E; D+0.525E+0.75L; 0.6D+0.7E; D+L+H+F+T.
  No 1.33 allowable increase is stated in the regulation → toggle default **OFF**, printed when used.
- MR6_2527 SDM: 1.4D+1.7L; 0.75(1.4D+1.7L+1.7W); 0.9D+1.3W. WSD: D+L; 0.75(D+L+W).
- W and E apply in ±X and ±Y.

**φ (RC) per MR2566** — project option "มีการควบคุมคุณภาพ (QC)" default ON:
| action | with QC | without QC |
|---|---|---|
| flexure, axial tension | 0.90 | 0.75 |
| spiral column | 0.75 | 0.625 |
| tied column | 0.70 | 0.60 |
| shear, torsion | 0.85 | 0.70 |
| bearing | 0.70 | 0.60 |
ACI318 set uses ACI φ (0.90 / 0.75 spiral / 0.65 tied / 0.75 shear / 0.65 bearing) with εt transition. MR2566 & MR6 use ρmax = 0.75ρb.
**Steel LRFD φ per MR2566:** tension yield 0.90, fracture 0.75; compression, flexure, shear 0.90 (note: shear 0.90, not AISC's 1.00); connections 0.75.

**Live loads per MR2566 ข้อ 11 (kg/m²)** — replaces the §3 table: roof 50; concrete canopy 100; housing / hotel & condo rooms 200;
rooftop deck 200; office, classroom 250; shophouse commercial part 300; car park ≤7 seats 300; fixed-seat assembly 300;
movable-seat assembly 400; retail 400; hotel service areas 400; fire stair 400; lobby/stair/corridor of assembly bldg 500;
wholesale, storage, industrial 500; bus/truck parking 800. Mark `verified:true, source:'MR2566 ข้อ 11'`.
Live-load reduction ข้อ 13 (optional, multi-storey columns/footings): 0% roof + 3 floors below, then 10, 20, 30, 40, max 50% from 7th floor below roof;
ข้อ 14 not allowed for assembly, schools, hospitals, warehouses, factories, parking, LL > 500.
Impact ข้อ 16: lifts +100%, light machinery +20%, reciprocating +50%, hung floors +33%.

**Wind**: MR2566 ข้อ 17 simplified pressure (H ≤ 40 m and H ≤ 3B): city 60/80/120 kg/m² for 0–10/10–20/20–40 m; open/coastal 100/120/160;
public building ≥ 1,000 m² +15%. Offer this as method "MR2566 ข้อ 17 (แบบง่าย)" alongside "มยผ. 1311-50" (still current).
**Seismic**: MR2566 ข้อ 18 defers to กฎกระทรวงแผ่นดินไหว พ.ศ. 2564 (in force; no amendment found; no post-Mar-2025 change gazetted as of Oct 2026 —
DPT announced a revision May 2025, still draft). มยผ. 1301/1302-61 current.
Zones (2564): Zone 1 (14): กระบี่, ชุมพร, สงขลา, สุราษฎร์ธานี, ตรัง, นครพนม, นครศรีธรรมราช, บึงกาฬ, ประจวบคีรีขันธ์, พิษณุโลก, เพชรบุรี, เลย, สตูล, หนองคาย.
Zone 2 (17): กรุงเทพมหานคร, นนทบุรี, ปทุมธานี, สมุทรปราการ, สมุทรสาคร, พังงา, ภูเก็ต, ระนอง, กำแพงเพชร, ชัยนาท, นครปฐม, นครสวรรค์, พระนครศรีอยุธยา, ราชบุรี, สมุทรสงคราม, สุพรรณบุรี, อุทัยธานี.
Zone 3 (12): กาญจนบุรี, เชียงราย, เชียงใหม่, ตาก, น่าน, พะเยา, แพร่, แม่ฮ่องสอน, ลำปาง, ลำพูน, สุโขทัย, อุตรดิตถ์. Others: not in a regulated zone.
**Deflection** (ประกาศ มท. 2567): L/360 live, L/240 total for floors/beams. Unit weights RC 2400, steel 7850.
**Licensing**: กฎกระทรวงกำหนดสาขาวิชาชีพวิศวกรรมและวิชาชีพวิศวกรรมควบคุม พ.ศ. 2565 (replaces 2550); ข้อบังคับสภาวิศวกร (โยธา) พ.ศ. 2566:
วุฒิ = all; สามัญ = all design/calc; ภาคี = buildings ≤ 4 storeys or storey height ≤ 5 m (not public buildings; seismic-regulated work needs seismic training).
Controlled work if any: ≥3 floors, floor height ≥4 m, span ≥5 m, cantilever ≥2 m, public building, ≥150 m² on slope ≥35° (yotathai summary — verify).

Source: construction-consultant brief (written from memory). Items tagged **[VERIFY]** must be checked
against the primary document; **[DO NOT SHIP UNVERIFIED]** items ship only as data rows flagged
`verified:false` with a visible warning badge — never silently as if official.

## 0. Cross-cutting rules
- Units: analysis in **kgf, m** (E in kg/m²). Design modules in **kg, cm, ksc**. Report in kg, cm, ksc, kg-m. Convert only at module boundaries.
- fc' is cylinder strength (ksc). UI toggle cube/cylinder: fc'(cyl) = 0.80 × cube. **[VERIFY]**
- Each project stores the standard edition / combo set it was designed under; the report prints it.
- Never auto-fill engineer name / license no. The engineer types them.

## 1. Standards per module
| Module | Basis | Fallback |
|---|---|---|
| RC SDM | วสท. 1008-38 (ACI 318-style) **[VERIFY latest 011008-xx]** | ACI 318-14/19 (cross-check only) |
| RC WSD | วสท. 1007-34 **[VERIFY]** | — |
| Steel LRFD/ASD | วสท. 011038 **[VERIFY]** | AISC 360-16 |
| Steel material | มอก. 1227, 1228; SS400, SM490, A36, A572 Gr50 | |
| Rebar | มอก. 20 (SR24), มอก. 24 (SD30/40/50) | |
| Loads | กฎกระทรวงฯ รับน้ำหนัก ... พ.ศ. 2566 (replaces ฉบับที่ 6/2527?) **[VERIFY]** | |
| Wind | มยผ. 1311-50 **[VERIFY revision]** | |
| Seismic | มยผ. 1301/1302-61 + กฎกระทรวงแผ่นดินไหว 2564 **[VERIFY]** | ASCE 7-10 |
| Licensing | พ.ร.บ.ควบคุมอาคาร 2522, พ.ร.บ.วิศวกร 2542, กฎกระทรวงงานวิศวกรรมควบคุม 2550 | |

Registry row schema: `id, titleTh, titleEn, issuer, type(law|regulation|standard|international), editionYear,
status(current|superseded|draft|unknown), supersedes, appliesToModules[], officialUrl, lastVerifiedDate,
verifiedBy, notes`. Default status `unknown`. Show "not verified in last 180 days" badge. Never invent deep links.

## 2. Load combinations (data, not hard-coded; user-selectable set)
**Set A legacy (EIT 1008-38 / ฉบับที่ 6), SDM:** 1.4D+1.7L; 0.75(1.4D+1.7L+1.7W); 0.9D+1.3W; 1.4D+1.7L+1.7H.
**Set B current (ACI 318-14 / ASCE 7 style; believed adopted by 2566 reg) [VERIFY]:** 1.4D; 1.2D+1.6L;
1.2D+1.0L+1.0E; 0.9D+1.0E; 1.2D+1.0L+γW·W; 0.9D+γW·W (γW parameter, default 1.6 **[VERIFY]**).
**WSD:** D+L; D+W; 0.75(D+L+W); D+0.7E; 0.6D+0.6W; 0.6D+0.7E. Optional 1.33 allowable increase for W/E combos (toggle, default on, printed).
Selector: `Legacy`, `Current`, `Envelope` (default Envelope unless 2566 reg mandates Set B). Seismic/wind always via Set B in SDM.
φ tied to set: Legacy → φv 0.85, φc tied 0.70, spiral 0.75, bearing 0.70. Current → φv 0.75, tied 0.65, spiral 0.75, bearing 0.65. Flexure 0.90 both.
"D" includes self-weight + superimposed dead (SD).

## 3. Loads & materials
Live loads (kg/m², editable seed, **[VERIFY vs 2566 table]**): roof 30; canopy/accessible RC roof 100; residence/kindergarten/toilet 150;
row/shop house, dormitory, hotel room, patient room 200; office, bank 250; shop/commercial, restaurant, classroom, non-res corridor & stairs 300;
assembly hall/theatre/gym/grandstand/exhibition 400; library/book storage/light industrial/printing 400–500; warehouse/heavy industrial 500;
car park cars 250–300; trucks ≥500. Override requires a "basis/remark" field printed in report.
Unit weights (kg/m³): RC 2400; plain conc 2300; steel 7850; mortar 2100; soil 1800; water 1000; timber 600–800.
SDL (kg/m²): finish 100–150; ceiling+MEP 20–50; brick wall 10cm 180–200; AAC 10cm 60–70; light partition 30–40. Walls as line loads (kg/m² × h).
Concrete fc' 180/210/240/280/320 ksc; Ec = 15100√fc'; β1 = 0.85 (fc'≤280) −0.05 per 70 ksc, min 0.65. Es = 2.04e6 ksc.
Rebar fy: SR24 2400; SD30 3000; SD40 4000; SD50 5000. Steel: SS400 Fy2450/Fu4100; A36 2530/4080; SM490 3250/5000; A572-50 3515/4570 **[VERIFY]**.
WSD: fc = 0.45fc'; fs SR24 1200, SD30 1500, SD40 1700, SD50 1700; n = Es/Ec (show value); vc = 0.29√fc'; max v = vc + 1.06√fc'.

## 4. Design checks (kg, cm, ksc)
### RC beam SDM
a = As·fy/(0.85fc'b); φMn = φAs·fy(d − a/2). ρb = 0.85β1(fc'/fy)[6120/(6120+fy)]; ρmax = 0.75ρb (Legacy) or εt ≥ 0.004 (Current).
As,min = max(0.80√fc'/fy, 14/fy)·bw·d. Doubly reinforced with compression-steel yield check. T-beam effective flange.
Shear: Vc = 0.53√fc'·bw·d; Vs = Av·fy·d/s; Vs ≤ 2.1√fc'bw·d; smax = min(d/2, 60) halved if Vs > 1.1√fc'bw·d; Av,min = 3.5bw·s/fy; φ(Vc+Vs) ≥ Vu.
Torsion: not designed in v1 — warn when Tu > 0.25·φ·Tcr (Tcr = 1.06√fc'·Acp²/pcp).
Deflection min h: simple l/16, one end cont. l/18.5, both l/21, cantilever l/8; ×(0.4+fy/7000) when fy≠4000.
Cover: beam/col 3 cm, slab 2 cm, footing 7.5 cm. Clear spacing ≥ max(db, 2.5).
### RC beam WSD
Cracked transformed section: k = √(2ρn+(ρn)²) − ρn, j = 1 − k/3; fc ≤ 0.45fc', fs ≤ allowable; doubly reinforced (2n for comp. steel); shear with WSD stresses.
### Slabs
One-way: min-thickness table; moment coeffs (wl²/8 simple, /11, /16, /10, /9 etc. ACI); temp steel ρ 0.0025 SR24, 0.0020 SD30/SD40, 0.0018 fy≥4000; spacing ≤ min(3h, 45).
Two-way: coefficient method (EIT appendix / ACI 318-63 Method 2), m = la/lb, 9 edge cases; **coefficient tables [DO NOT SHIP UNVERIFIED]** — ship structure + flag.
Min h: perimeter/180. Edge strip = 2/3 middle-strip moment.
### RC column SDM
ρg 1–4% (8% abs max); min 4 bars rect / 6 circular; db ≥ 12 mm. Ties ≤ min(16db, 48dtie, least dim).
P0 = 0.85fc'(Ag−Ast) + fy·Ast; φPn,max = 0.80φP0 tied / 0.85φP0 spiral.
P-M by strain compatibility, εcu 0.003, ≥30 points. Biaxial Bresler: 1/Pn = 1/Pnx + 1/Pny − 1/P0 (Pn ≥ 0.1P0), else Mux/φMnx + Muy/φMny ≤ 1.
Slenderness: non-sway neglect if klu/r ≤ 34−12(M1/M2) ≤ 40; sway ≤ 22. δns = Cm/(1 − Pu/(0.75Pc)), Pc = π²EI/(klu)², EI = 0.4EcIg/(1+βd). Reject klu/r > 100. Sway frame without P-Δ → hard warning.
emin = 1.5 + 0.03h (cm) **[VERIFY]**. WSD column: Pa = 0.80[0.25fc'Ag + fs·Ast] tied / 0.85 spiral **[VERIFY]**.
### Isolated footing
Service q = P/A ± 6M/(BL²) ≤ qa (user input), no tension (kern). Factored net qu. One-way shear at d: φ0.53√fc'·b·d.
Punching at d/2: vc = min(1.06√fc', 0.53(1+2/βc)√fc', 0.27(αs·d/bo+2)√fc') (αs = 40 interior). Flexure at column face; ρmin 0.0018–0.0020.
Cover 7.5; min d 15 cm. Overturning/sliding FS ≥ 1.5 when horizontal load present.
### Steel (AISC 360-style)
LRFD φb 0.90, φv 1.00 (rolled I, h/tw ≤ 2.24√(E/Fy)), φc 0.90, φt 0.90; ASD Ωb 1.67, Ωv 1.50, Ωc 1.67, Ωt 1.67.
Compact: flange λp 0.38√(E/Fy), λr 1.0√(E/Fy); web λp 3.76√(E/Fy). Noncompact flange: linear interpolation; slender → "not supported".
LTB: Mp = FyZx; Lp = 1.76ry√(E/Fy); Lr per AISC F2-6; Lp<Lb≤Lr: Mn = Cb[Mp − (Mp − 0.7FySx)(Lb−Lp)/(Lr−Lp)] ≤ Mp;
Lb > Lr: Fcr = Cbπ²E/(Lb/rts)² √(1 + 0.078(Jc/(Sx·ho))(Lb/rts)²), Mn = FcrSx ≤ Mp. Cb = 12.5Mmax/(2.5Mmax+3MA+4MB+3MC) ≤ 3, default 1.0.
Shear Vn = 0.6FyAwCv, Aw = d·tw. Compression: Fe = π²E/(KL/r)²; KL/r ≤ 4.71√(E/Fy): Fcr = 0.658^(Fy/Fe)·Fy, else 0.877Fe; KL/r ≤ 200, warn > 120.
H1-1: Pr/Pc ≥ 0.2: Pr/Pc + 8/9(Mrx/Mcx + Mry/Mcy) ≤ 1; else Pr/(2Pc) + (Mrx/Mcx + Mry/Mcy) ≤ 1. Deflection L/360 live, L/240 total.
Section library: มอก. 1227 H, I, channels, pipes, tubes with A, d, bf, tw, tf, Ix, Iy, Sx, Sy, Zx, Zy, rx, ry, J, Cw — cross-check ≥3 sections.
### Frame analysis
Direct stiffness, 12×12 3D frame elements. Report N, Vy, Vz, T, My, Mz at ends and stations. Optional rigid diaphragm per floor.
Cracked modifiers (strength analysis): beams 0.35Ig, columns 0.70Ig — editable, printed.

## 5. Wind (มยผ. 1311-50) & seismic (มยผ. 1301/1302-61)
Wind static: p = Iw·q·Ce·Cg·Cp; q = ½ρV², ρ = 1.25 kg/m³ (q in kg/m² = 0.5·1.25·V²/9.81).
V50 25/27/29/31 m/s → q 39.8/46.5/53.6/61.2 kg/m². Province→zone **[DO NOT SHIP UNVERIFIED]**.
Iw: 0.8 low, 1.0 normal, 1.15 high/essential (strength); 0.75 serviceability **[VERIFY]**.
Ce: open A: (H/10)^0.2 ≥ 0.9; rough B: 0.7(H/12)^0.3 ≥ 0.7 **[VERIFY]**. Cg 2.0 main, 2.5 cladding. Cp windward +0.8, leeward −0.5 (H/D≥1) to −0.3; net ≈ 1.3.
Static applicable H < 80 m, H/D < 3, fn > 1 Hz, else "dynamic procedure required".
Unit test: V50 25, Iw 1, H 30, open, Cg 2, Cp 1.3 → Ce 1.246, p ≈ 129 kg/m².
Apply as nodal loads at floor levels (tributary façade) both directions; ±5% eccentricity.
Seismic ELF: SMS = Fa·Ss, SM1 = Fv·S1; SDS = 2/3 SMS, SD1 = 2/3 SM1. Fa/Fv tables **[DO NOT SHIP UNVERIFIED]** (ship ASCE 7-10 tables flagged).
Site class A–F user-selected. Ie 1.0/1.25/1.5. SDC from SDS/SD1.
R/Ω0/Cd: RC SMF 8/3/5.5; RC IMF 5/3/4.5; RC OMF 3/3/2.5; RC special SW 6/2.5/5; RC ordinary SW 5/2.5/4.5; dual 7/2.5/5.5; steel SMF 8/3/5.5; steel IMF 4.5/3/4; steel OMF 3.5/3/3; steel SCBF 6/2/5.
Ta = Ct·hn^x: steel MF 0.0724/0.8; concrete MF 0.0466/0.9; EBF/BRBF 0.0731/0.75; other 0.0488/0.75. T ≤ Cu·Ta (Cu 1.4 for SD1≥0.3 … 1.7 for SD1≤0.1).
Cs = SDS/(R/Ie) ≤ SD1/(T(R/Ie)) (T≤TL) or SD1·TL/(T²(R/Ie)); Cs ≥ max(0.044SDS·Ie, 0.01). V = Cs·W.
W = DL + SDL + partitions + 25% storage LL. Fx = Cvx·V, Cvx = wx·hx^k/Σwi·hi^k; k = 1 (T≤0.5), 2 (T≥2.5), linear.
Accidental torsion 5%. Drift Δ = Cd·δe/Ie ≤ 0.020hsx (RC I/II). Irregular / out-of-limit → "dynamic analysis required" warning.
Province seed: Bangkok, Nonthaburi, Samut Prakan, Pathum Thani, Chiang Mai, Chiang Rai, Kanchanaburi, Tak, Phuket, Songkhla, Khon Kaen, Nakhon Ratchasima, Chonburi — all `verified:false`, values as editable placeholders.

## 6. Permit calculation report (รายการคำนวณ)
1 Cover (project, location, owner, building use, stories, area, height, system, date, revision) · 2 Contents + revision log ·
3 Design criteria (standards + editions, method, materials, combo set, φ, modifiers) · 4 References (registry rows + lastVerifiedDate) ·
5 Loads (DL items, LL row/override, wind params & pressures, seismic params & story forces) · 6 Model (plan/elevation, nodes/members, supports, modifiers) ·
7 Analysis results (reactions, drift, max member forces N/Vy/Vz/T/My/Mz, deflection) ·
8 Member designs (inputs, formulas with substituted numbers, D/C ratio, OK/NOT OK) · 9 Conclusions & warnings (not-covered checks) ·
10 Signature block: engineer name, กว. license no., สาขาวิศวกรรมโยธา, level (ภาคี/สามัญ/วุฒิ), signature, date — engineer fills; on cover + last page (+footer).
Legal note: must be prepared & signed by a licensed civil engineer (วิศวกรรมควบคุม) under พ.ร.บ.วิศวกร 2542; level thresholds by building size per กฎกระทรวง 2550 (guidance only, config).
Disclaimer: software is a calculation aid; signing engineer is responsible.

## 7. Release checklist
Verify registry; obtain 2566 load reg; 1311-50 tables; 1301/1302-61 + 2564 province list, Fa/Fv, TL, drift; transcribe two-way slab tables;
one hand-checked worked example per module as regression test; licensed engineer reviews report template before real use.
