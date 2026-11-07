# Bird Wing Motion in Flocks: Biology and Procedural Animation for a WebGL Boids Visualization

Scope note: two linked subtopics. (A) the biology of wing motion in group flight: wingbeat phasing, flap vs. glide, turning and banking, speeds. (B) how graphics, film and game systems animate bird wings procedurally, with concrete, sourced formulas and code. The target is lightweight, real-time techniques for hundreds to thousands of birds in a browser. Some details came from search-result snippets rather than full-text reads because several primary PDFs (Nature, PMC, core.ac.uk, RVC repository) returned 403 errors or browser checks. Those cases are flagged inline.

---

## Q1. Do birds in V-formations phase-match their wingbeats, and how does phasing depend on position? (Portugal et al. 2014)

### Takeaway
Yes. Northern bald ibises flying in the diagonal V position flap in *spatial* phase with the bird ahead: the follower's wingtip retraces the leader's wingtip path through the air, so it catches upwash for the whole flap cycle. Birds flying directly behind another bird flap in close to spatial *anti*-phase, which probably reduces the downwash they fly into. Phasing therefore depends on relative position, and it is defined in space (wake path), not as simple temporal synchrony.

### Cited Findings
- Citation: Portugal, S.J. et al., "Upwash exploitation and downwash avoidance by flap phasing in ibis formation flight", *Nature* 505(7483):399–402 (2014), doi:10.1038/nature12939 — [Oxford Biology listing](https://biology2.web.ox.ac.uk/node/4076641); [Nature](https://www.nature.com/articles/nature12939)
- Subjects were a free-flying flock of critically endangered northern bald ibises (*Geronticus eremita*), fitted with loggers that recorded each bird's position, speed and heading — [EurekAlert press release](https://www.eurekalert.org/pub_releases/2014-01/eaps-ntr011614.php); [Sci.News](https://www.sci.news/biology/science-birds-v-shaped-formation-01694.html)
- Instruments: back-mounted GPS at 5 Hz and inertial measurement units at 300 Hz. They captured the position and every wing flap of 14 birds over 43 minutes of migratory flight (from a search snippet of the paper's text, not a full read) — [ResearchGate full-text PDF (snippet)](https://www.researchgate.net/profile/Steven_Portugal/publication/259766376_Upwash_exploitation_and_downwash_avoidance_by_flap_phasing_in_ibis_formation_flight/links/0046353629e2f160d9000000.pdf)
- In the V position, spatial phasing of wingbeats produces "wingtip path coherence" between birds, which maximizes upwash capture over the whole flap cycle — [Oxford Biology](https://biology2.web.ox.ac.uk/node/4076641); [ScienceDaily](https://sciencedaily.com/releases/2014/01/140116112942.htm)
- Definition used in the paper: flapping in spatial phase means "the wing of a following bird goes up and down following the path through the air previously traced". Birds directly behind (streamwise) flap in close to spatial antiphase — [ResearchGate PDF (snippet)](https://www.researchgate.net/profile/Steven_Portugal/publication/259766376_Upwash_exploitation_and_downwash_avoidance_by_flap_phasing_in_ibis_formation_flight/links/0046353629e2f160d9000000.pdf); [Science News](https://sciencenews.org/article/v-flying-birds-pick-efficient-flapping-pattern)
- The birds' positions matched theoretical aerodynamic predictions for optimal V positions, but individual positions varied within the flock. There was no clear leader, which the authors suggest may reflect the birds' young age — [Sci.News](https://www.sci.news/biology/science-birds-v-shaped-formation-01694.html); [Oxford Biology](https://biology2.web.ox.ac.uk/node/4076641)
- The streamwise sampling region in the analysis was about 4 m, with birds up to roughly 1.5 m behind the bird ahead (snippet, partly truncated) — [ResearchGate PDF (snippet)](https://www.researchgate.net/profile/Steven_Portugal/publication/259766376_Upwash_exploitation_and_downwash_avoidance_by_flap_phasing_in_ibis_formation_flight/links/0046353629e2f160d9000000.pdf)

### Inferences
- Because the phasing is *spatial*, the temporal phase offset a follower needs depends on how far back it is. The wake travels backward relative to the birds at roughly flight speed U, so a follower Δx metres behind meets the leader's wake path about Δx/U seconds later. That gives a temporal phase lag of about Δφ ≈ 2π·f·Δx/U (mod 2π), where f is wingbeat frequency. *This is my derivation from the paper's definition of spatial phase, not a formula quoted from it.* For a boid in a V/echelon slot, you can set its phase offset relative to the bird ahead using this expression. For a bird directly behind, add π (anti-phase).
- In a starling/pigeon-style cluster (not a V), there is no evidence of a position-locked phase rule (see Q2), so random per-boid phase offsets are the biologically defensible default.
- Visually, phase locking is noticeable only in sparse, orderly formations (geese, ibis, pelicans). In dense murmurations it is not expected.

### Gaps
- I could not get the full text (Nature paywall; core.ac.uk and the RVC repository returned 403), so I have no ibis wingbeat frequency in Hz, flight speed, exact lateral/streamwise offsets or wingtip-overlap values, or the paper's quantitative phase-vs-distance fit. A search snippet indicates the paper's frequency discussion cites earlier pelican work rather than reporting ibis values.
- I found no comparable phasing data for geese specifically.

---

## Q2. Do birds in dense flocks (pigeons, starlings) change flapping vs. gliding? How do turns propagate, and how do individuals bank?

### Takeaway
Dense flocking costs effort. Pigeons flying in a cluster flap *faster* than when solo (around +0.1 Hz near neighbours), and there is no evidence of an aerodynamic benefit. That cost is attributed to control and collision avoidance, not wake exploitation. In starling flocks, turns spread from bird to bird as a nearly undamped, linear wave at 20–40 m/s, faster than the birds fly (7–12 m/s). Individual birds turn mainly by *banking* (rolling the lift vector) rather than by changing speed, and in a turn they briefly lose altitude because banking diverts lift.

### Cited Findings
**Pigeons (Usherwood et al. 2011)**
- Citation: Usherwood, J.R. et al., "Flying in a flock comes at a cost in pigeons", *Nature* 474:494–497 (2011) — [Nature](https://www.nature.com/articles/nature10164); [PMC open copy](https://pmc.ncbi.nlm.nih.gov/articles/PMC3162477) (the PMC fetch returned a browser check, so details below come from search snippets and secondary sources)
- The study measured how airspeed, induced power, climbing power and accelerating power each affected flap frequency and dorsal amplitude, flap by flap, across 18 pigeons and 171,209 flaps — [search snippet of Nature/PMC abstract](https://pmc.ncbi.nlm.nih.gov/articles/PMC3162477)
- Conclusion: flocking pigeons get no aerodynamic advantage like V-formation pelicans do, and their higher flap rate points to an energetic cost of tight cluster flight — [Physics Today: "Pigeons do not flock to save energy"](https://physicstoday.aip.org/news/pigeons-do-not-flock-to-save-energy); [Nature](https://www.nature.com/articles/nature10164)
- Effect size as summarized by later work: pigeons near neighbours raise flap rate by about 0.1 Hz — [The Science of Nature, 2019 (via search snippet)](https://link.springer.com/doi/10.1007/s00114-019-1641-x)
- Follow-up (2019, six pigeons, 177 km flight): as birds spread out over the flight, pairwise and group distances increased while flap frequency decreased, read as a partial reversal of the flocking cost — [The Science of Nature, 2019 (via search snippet)](https://link.springer.com/doi/10.1007/s00114-019-1641-x)

**Starlings: turn propagation (Attanasi et al. 2014)**
- Citation: Attanasi, A. et al., "Information transfer and behavioural inertia in starling flocks", *Nature Physics* (2014), doi:10.1038/nphys3035 — [Springer/Nature Physics](https://link.springer.com/article/10.1038/nphys3035); [arXiv:1303.7097 "Superfluid transport of information in turning flocks of starlings"](https://ar5iv.arxiv.org/html/1303.7097)
- Turn information propagates at about 20–40 m/s, while the flocks themselves flew at about 7–12 m/s. Propagation speed did not correlate with flock speed — [arXiv 1303.7097](https://arxiv.org/pdf/1303.7097v1.pdf); [Phys.org](https://phys.org/news/2014-07-starling-flight-reveals-message-bird.html)
- The distance the information covers grows *linearly* with time, with little attenuation. A 400-bird flock can be swept by a turn in a little over half a second — [arXiv 1303.7097](https://ar5iv.arxiv.org/html/1303.7097); [Phys.org](https://phys.org/news/2014-07-starling-flight-reveals-message-bird.html)
- Propagation is faster in more ordered flocks (later preprint) — [arXiv 1410.3330 "Emergence of collective changes in travel direction of starling flocks"](https://ar5iv.labs.arxiv.org/html/1410.3330)

**Starlings: banking (Hemelrijk & Hildenbrandt StarDisplay model)**
- "Real birds roll into the turn in order to make turns." In StarDisplay, individuals bank toward the turn instead of changing speed. Banking produces a centripetal force at the cost of lift, so the flock temporarily loses altitude — [Hemelrijk & Hildenbrandt 2011, PLoS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- Model forces: lift and drag scale with air density, wing area and dimensionless coefficients, with a fixed lift/drag coefficient ratio. In level flight, lift balances weight and thrust balances drag. Gravity points to global down, lift to the bird's *local* up, and drag opposes forward motion (Eqs. 15–16) — [PLoS ONE 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- Banking (Eqs. 17–20): the change in bank angle depends on the lateral acceleration from the steering force, with separate weights for rolling *into* and *out of* the turn, plus a tendency to roll back to horizontal. The ratio of these weights sets the roll rate. (The equations are images on the page and were not transcribed.) — [PLoS ONE 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- Speed control: a force with a relaxation time pulls each bird back to its cruise speed (Eq. 1). Birds keep speed nearly constant, with a coefficient of variation of about 0.01–0.015 (fish, for comparison, about 0.05–0.20). Low speed variability is what makes the flock's shape and orientation change during turns — [PLoS ONE 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479); [Univ. Groningen press release](https://www.rug.nl/news/2011/08/113_11hemelrijk)
- Default topological interaction: about 6.5 neighbours. Flocks of 200 and 2,000 were simulated — [PLoS ONE 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- A 2019 StarDisplay study found that "agitation waves" (dark bands moving through murmurations) fade over time, mainly because of a reduced maximum banking angle during the zig-zag escape manoeuvre rather than a lower tendency to copy neighbours — [Behav. Ecol. Sociobiol. 2019 (search snippet)](https://link.springer.com/content/pdf/10.1007/s00265-019-2734-4.pdf)

### Inferences
- For a visualization: individual birds should *roll* into turns, with a bank roughly proportional to lateral (centripetal) acceleration. Rolling in should be faster than rolling out, with a gentle return to level. Speed should vary only slightly (CV around 1–1.5%), and turns should come with a small temporary sink.
- Turns should start at one point and *propagate*. A per-boid reaction delay of (distance from initiator)/(20–40 m/s, scaled to world units) imitates the starling turn wave. Standard boids with topological neighbours (around 6–7) already produce a version of this.
- Pigeon flap frequency rising by about 0.1 Hz in a flock is a tiny change (pigeon wingbeats are several Hz; see Q3). It is not worth modelling visually except as a small "crowding → slightly faster flapping" term.
- Dark "agitation waves" in murmurations are tied to wave-like *banking* (wings shown edge-on vs. face-on to the viewer). Correct per-bird roll therefore matters visually at murmuration scale, not just per bird.

### Gaps
- I found no primary source quantifying how often birds *glide* inside dense starling murmurations vs. flap. The Usherwood pigeon data concern flap frequency and amplitude, not glide fraction.
- Ballerini et al. 2008 / Cavagna et al. (topological interaction with about 7 neighbours, scale-free correlations) were not fetched directly. The 6.5-neighbour figure here comes from Hemelrijk's model, which uses it.
- StarDisplay's numerical parameters (cruise speed, maximum bank angle, roll weights, wingspan, mass, reaction time) are in a Table 1 image I could not read.
- I could not retrieve Usherwood's absolute solo vs. flock flap frequencies, amplitudes or airspeeds.

---

## Q3. Speed ranges and typical flight behaviors of flocking birds (starlings, pigeons, swallows, geese)

### Takeaway
Starling flocks fly at about 7–12 m/s. Many small birds fly *intermittently*: flap-gliding at slow speeds and flap-bounding (wings folded) at faster speeds, with the share of time spent flapping falling as speed rises. Starlings use both modes, and their wingbeat frequency rises roughly linearly with airspeed. Pigeon wingbeat frequency stays roughly constant across steady speeds. I found no reliable numbers for swallows or geese within the tool budget.

### Cited Findings
- Starling flocks studied in Rome moved at roughly 7–12 m/s — [arXiv 1303.7097 (Attanasi et al.)](https://arxiv.org/pdf/1303.7097v1.pdf)
- Some species flap-glide when flying slowly and shift toward flap-bounding at faster speeds. European starlings are among the small species that can do both, and budgerigars also switch — [Tobalske 2001, "Morphology, velocity, and intermittent flight in birds", Amer. Zool. 41:177 (search snippet)](https://bioone.org/journals/american-zoologist/volume-41/issue-2/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2/Morphology-Velocity-and-Intermittent-Flight-in-Birds1/10.1668/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2.full); [Rayner et al., "Aerodynamics and energetics of intermittent flight in birds"](https://abdn.elsevierpure.com/en/publications/aerodynamics-and-energetics-of-intermittent-flight-in-birds/)
- The percentage of time spent flapping in an intermittent-flight cycle decreases as speed increases (search snippet from Tobalske-group work) — [Tobalske 2001 (search snippet)](https://bioone.org/journals/american-zoologist/volume-41/issue-2/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2/Morphology-Velocity-and-Intermittent-Flight-in-Birds1/10.1668/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2.full); [Auk 113(1):151 (Tobalske 1996, search snippet)](https://sora.unm.edu/sites/default/files/journals/auk/v113n01/p0151-p0177.pdf)
- Starling wingbeat frequency shows a roughly linear relationship with airspeed (search snippet) — [JEB article PDF (search snippet)](https://cob.silverchair.com/jeb/article-pdf/2853086/jexbio_187_1_1.pdf)
- In black-billed magpies and pigeons, wingbeat frequency did not change appreciably across steady-speed flight (Tobalske & Dial 1996) — [Flight kinematics of black-billed magpies and pigeons over a wide range of speeds (search snippet)](https://typeset.io/pdf/flight-kinematics-of-black-billed-magpies-and-pigeons-over-a-3znrg2t2m9.pdf)
- Pigeon flap frequency and amplitude respond to airspeed, induced power, climbing power and accelerating power (measured over 171,209 flaps) — [Usherwood et al. 2011 (snippet)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3162477)
- Wingbeat mechanics change with bird size: in physics simulations of an eagle (3.7 kg), raven (0.5 kg) and sparrow (0.025 kg), the raven folds its wings inward on the upstroke during takeoff while the eagle sweeps its wings forward — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)

### Inferences
- For starling-like boids: cruise around 10 m/s with tight speed control (Q2), and wingbeat frequency rising with speed. A small-bird flap-bound mode (short flapping bursts followed by brief folded-wing "bounds") adds realism at higher speeds, and flap-glide with extended wings fits slower, descending or turning flight.
- For pigeon-like boids: keep frequency roughly constant with speed and modulate it mainly with climbing and acceleration (consistent with Usherwood's decomposition).
- For geese/ibis V-formations: large birds flap slowly with long glides less likely in steady migration, and phase locking by position applies (Q1). *Exact frequencies are a gap.*

### Gaps
- I found no sourced speed or wingbeat-frequency values for barn swallows, geese, or pigeons in Hz/m/s within the tool budget. Pennycuick's wingbeat-frequency scaling and published field measurements would fill this, but I did not retrieve them. Do not invent values. Tune visually or look up Pennycuick (1996/2008) and Tobalske (2007) directly.
- The intermittent-flight claims rely on search snippets of Tobalske's papers, not full reads.

---

## Q4. How do films, games and research systems animate bird wings? (Reynolds, three.js, Wu & Popović, Ju et al., production examples)

### Takeaway
Real-time systems (three.js GPGPU birds, Unreal Niagara flocks) separate *rigid flight* (boid position and orientation) from *cheap internal wing articulation* (a sine-driven vertex offset or a baked vertex-animation texture), with a per-bird phase that advances faster at higher speed. Reynolds' 1987 paper already specified banking by aligning the bird's up axis with gravity plus centripetal acceleration (a "coordinated turn"), but it left wing flapping as future work. Physics-based research (Wu & Popović 2003, Ju et al. 2013) is far too slow for real time, but its *wingbeat parameterization* (asymmetric downstroke/upstroke timing, wing folding during the upstroke) is directly reusable as a procedural curve.

### Cited Findings
**Reynolds 1987, "Flocks, Herds, and Schools: A Distributed Behavioral Model" (SIGGRAPH '87)**
- Geometric flight: "a dynamic, incremental, rigid geometrical transformation of an object, moving along and tangent to a 3D curve", based on incremental translation along the local +Z (forward) axis, updated at least once per frame — [Reynolds 1987 (mirror)](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/); [red3d.com](https://www.red3d.com/cwr/papers/1987/boids.html)
- Banking: "Geometric flight relates translation, pitch, and yaw, but does not constrain roll". Roll is used for "banking—rolling the object to align the local Y axis" with the accelerational down direction. "In straight flight there is no radial force, so the gravitational term dominates." In a turn, "the 'accelerational down' direction swings outward, like a pendulum hanging from the flying object", and "the local +Y (up) direction points directly at the center of curvature defined by the current turn" (in the pure-turn case). "With correct banking (what pilots call a coordinated turn) the object's local space remains aligned with the 'perceptual' or 'accelerational' coordinate system." "By simply reversing the angle of bank we obtain a cartoony motion" — [Reynolds 1987](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/)
- Flight constraints: "Geometric flight models conservation of momentum". Viscous speed damping; "A minimum speed can also be specified but defaults to zero"; "A maximum acceleration, expressed as a fraction of the maximum speed, is used to truncate" acceleration requests, "a simple model of a creature with a finite amount of available energy" — [Reynolds 1987](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/)
- Wings: "While the motion is rigid, the object's underlying geometric model is free to articulate or change shape". In the original tests, "There was no flapping of wings nor turning of heads", and defining a "wing flap cycle" with modeling/scripting tools was left as future work — [Reynolds 1987](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/)
- Boids software (modified) was used for bat swarms and penguin flocks in *Batman Returns* (1992). The film *Stanley and Stella in: Breaking the Ice* premiered at SIGGRAPH '87 — [red3d.com boids page](https://www.red3d.com/cwr/boids/)

**three.js `webgl_gpgpu_birds` example (GPU boids, wing flap in vertex shader)**
- Each bird is 9 vertices (body triangle plus two wing triangles); `wingsSpan = 20`; wing-tip vertices are index 4 at (−20,0,0) and index 7 at (+20,0,0); `birdVertex.array[v] = v % 9`; geometry scaled by 0.2 — [three.js source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_gpgpu_birds.html)
- The per-bird phase is stored in the `.w` channel of the position texture and advanced in the position fragment shader. It advances by base time plus horizontal speed plus climb rate, wrapping at 62.83 (about 10·2π) — [three.js source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_gpgpu_birds.html):
  ```glsl
  float phase = tmpPos.w;
  phase = mod( ( phase + delta +
      length( velocity.xz ) * delta * 3. +
      max( velocity.y, 0.0 ) * delta * 6. ), 62.83 );
  gl_FragColor = vec4( position + velocity * delta * 15. , phase );
  ```
- The flap is applied in the bird vertex shader only to the two wing tips, as a fixed-amplitude sine. Speed changes flap *rate* (via phase), not amplitude — [three.js source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_gpgpu_birds.html):
  ```glsl
  if ( birdVertex == 4.0 || birdVertex == 7.0 ) {
      // flap wings
      newPosition.y = sin( tmpPos.w ) * 5.;
  }
  ```
- Orientation is built from velocity only: a yaw matrix `maty` from the XZ heading (`cosry = velocity.x / xz`, `sinry = velocity.z / xz`) and a pitch-like matrix `matz` from `velocity.y` (`sinrz = velocity.y / xyz`), applied as `newPosition = maty * matz * newPosition`. The mesh has a fixed `birdMesh.rotation.y = Math.PI / 2`. `SPEED_LIMIT = 9.0`, raised by 5 near the predator (mouse) — [three.js source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_gpgpu_birds.html)

**Wu & Popović 2003, "Realistic Modeling of Bird Flight Animations" (ACM TOG 22(3), SIGGRAPH 2003)**
- Physics-based: an articulated skeleton with elastically deformable feathers, forward dynamics with joint torques and aerodynamic forces, and each wingbeat solved separately by optimization. It covers takeoff, cruising, rapid descent, turning and landing — [project page](https://grail.cs.washington.edu/projects/flight/wu2003realistic.html); [PDF](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Skeleton: shoulder (3 DOF ×2), elbow bend ×2, forearm twist ×2, wrist bend ×2, tail bend, tail twist, tail spread. The trunk has 6 DOF. Wingbeat parameters (Table 1) are given per downstroke (d) and upstroke (u): arm dihedral/sweep/twist angles, forearm twist, wing spread extents, tail bend, tail twist, tail spread, and duration u_T — [Wu & Popović 2003 PDF](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Wingbeat curve: q*_i(t) = q_min + (q_max − q_min)·g_k(u^d, u^u, φ(t)), with φ = 0 at the start of the downstroke and φ = 2π at the end of the upstroke. Two composite functions — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf):
  - g1(u^d, u^u, φ) = (u^u − u^d)·(1 + cos φ)/2 + u^d (smooth sinusoid; used for **arm dihedral** (flap) and tail bend)
  - g2(u^d, u^u, φ) = u^d for 0 ≤ φ < π; (u^u − u^d)·(1 − cos 2φ)/2 + u^d for π ≤ φ < 2π (held constant through the downstroke, then a quick excursion and return during the upstroke; used for **arm sweep, arm/forearm twist, and wing spread**, i.e. folding)
- Rationale (Appendix A): "During downstroke, the bird holds its forearms fixed with respect to the arms. During upstroke, the bird quickly retracts its wings and rotates forearms in order to reduce the downward drag caused by the primary feathers. It then quickly extends the wings again near the end of the upstroke to prepare for the next downstroke." The tail moves in sync with the wingbeat (g1) for balance — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Asymmetric timing: parameters u_α and u_β set the *fraction of the wingbeat taken by the downstroke*. A phase-warp function h(φ) with h(0)=0, h(2·u_α·π)=π, h(2π)=2π, h′(0)=h′(2π)=1 is applied (φ′ = h(φ)). The downstroke/upstroke duration ratio is u_α/(1 − u_α). g2 DOFs are phase-offset so that their upstroke and downstroke midpoints line up with the g1 DOFs — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Blending consecutive (different) wingbeats: each wingbeat starts and ends at *mid-upstroke*, "when the wings are usually at their neutral" position, and desired-state curves are blended over a window [t_T − t_b, t_T + t_b] to remove C0/C1 discontinuities — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Primary feathers twist about their shafts on the upstroke, letting air through and reducing upstroke drag. Turns: "a bird compensates for inertia by tilting its body and using an asymmetric wingbeat". Landing uses wing drag and/or flapping against the motion — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Aerodynamics: per feather segment, angle of attack θ = atan((v·n)/‖v_t‖), drag along the relative air velocity, lift perpendicular to it, using synthesized c_l(θ), c_d(θ) curves and segment areas scaled for feather overlap — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Cost: simulated-annealing optimization at 1,000 iterations per wingbeat. Timesteps of 0.001 / 0.0007 / 0.00025 s (eagle / raven / sparrow). Optimizing 6.7 / 5.2 / 3.8 s flights took 218 / 232 / 324 minutes on a 2.8 GHz Pentium 4. Offline only — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)

**Ju et al. 2013, "Data-Driven Control of Flapping Flight" (ACM TOG 32(5))**
- Authors Eunjung Ju, Jungdam Won, Jehee Lee, Byungkuk Choi, Junyong Noh, Min Gyu Choi. They recorded a dove with marker-based optical motion capture and high-speed video, and learned wingbeat controllers from sparse, biased observations. The simulated bird imitates life-like flapping while actively keeping its balance. The project page links the paper, slides, simulation code and motion-capture data — [SNU project page](https://mrl.snu.ac.kr/research/ProjectBird/birdFlight.htm); [SIGGRAPH history](https://history.siggraph.org/?p=105017)

**Production and hobbyist real-time examples**
- Epic's *The Matrix Awakens* demo used simple bird meshes with texture-based (baked vertex) animation, with flocking driven by Unreal's Niagara particle system using a boids-style algorithm (from a search-result summary; article not fetched) — [befores & afters, "How to sim birds" (2022)](https://beforesandafters.com/2022/04/04/how-to-sim-birds/)
- A TouchDesigner GLSL compute-shader boids tutorial uses spatial binning for neighbour search and reports instancing up to about 200,000 boids when the bird mesh has very few vertices (search snippet) — [alltd.org](https://alltd.org/?p=16835)
- A Godot procedural-bird devlog (search snippet only; the page returned 404 on fetch): wing flapping from a sine wave with mirrored opposite signs for the two wings; a random per-bird phase so the flock doesn't flap in unison; roll into turns scaled by how sharply the bird is turning; harder flapping when climbing; wings held still to glide when descending; "no flight simulation underneath, just a handful of rules" — [alexlaverty.github.io (search snippet)](https://alexlaverty.github.io/blog/building-a-bird-from-boxes/)
- Developers recommend the vertex shader as the place for wing-flap animation (r/gamedev butterfly tutorial thread, search snippet) — [r/gamedev thread mirror](https://redlib.hbubli.cc/r/gamedev/comments/a2v6pa/ive_completed_a_tutorial_on_animating_butterfly)

### Inferences
- The three.js example is the closest public reference for this project's stack. Its gaps relative to the biology: (1) **no roll/bank** (orientation is yaw + pitch only); (2) **constant flap amplitude**; (3) **no glide state**; (4) a **symmetric** sine (equal downstroke and upstroke); (5) **no wing folding** on the upstroke. Each can be added cheaply in the same vertex/position shaders.
- Physics-based methods (Wu & Popović, Ju et al.) are offline: hours of optimization for seconds of flight. Their *curve shapes* (g1/g2 and the downstroke-fraction warp) can still be evaluated per vertex at essentially zero cost.
- Baked vertex-animation textures (the Matrix Awakens approach) are a good alternative if a richer artist-made flap cycle is wanted. The procedural phase variable then indexes into the texture instead of driving a sine.

### Gaps
- I did not find a GDC talk with documented procedural bird-flight formulas within the tool budget. The *befores & afters* Matrix Awakens article and the Godot devlog are cited from search snippets only.
- Reynolds' paper describes banking qualitatively. It gives no explicit equation or smoothing constants.
- Unity Boids / Unreal Niagara sample projects were not examined.

---

## Q5. Concrete, lightweight techniques and formulas for procedural wing animation (flap rate/amplitude vs. speed and acceleration, glide phases, banking, folding, per-boid phase)

### Takeaway
A biologically informed, GPU-friendly recipe is to keep a per-boid phase φ (as in three.js) that advances at a rate driven by speed, climb and forward acceleration (as in Usherwood's decomposition). Warp φ for a downstroke longer than the upstroke (Wu & Popović's u_α). Drive wing dihedral with a cosine (g1) and wing span/fold with an upstroke-only pulse (g2). Blend amplitude toward zero for glide or bound phases (Tobalske). Set roll so the body's up axis follows gravity plus centripetal acceleration (Reynolds), smoothed with faster roll-in than roll-out (Hemelrijk). Everything except the formulas quoted from sources is **illustrative** and needs tuning.

### Cited Findings
- Phase advance tied to speed and climb (three.js): φ += dt + |v_xz|·dt·3 + max(v_y,0)·dt·6, wrapped at 62.83; wing-tip y = sin(φ)·5 — [three.js source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_gpgpu_birds.html)
- Pigeon flap frequency and dorsal amplitude are affected by airspeed, induced power, climbing power and accelerating power, and frequency rises near neighbours — [Usherwood et al. 2011 (snippet)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3162477); [Sci. Nat. 2019 (snippet)](https://link.springer.com/doi/10.1007/s00114-019-1641-x)
- Flap curve g1 = (u^u − u^d)(1 + cos φ′)/2 + u^d for dihedral; fold curve g2 = u^d on the downstroke, (u^u − u^d)(1 − cos 2φ′)/2 + u^d on the upstroke; downstroke fraction u_α through the warp h(φ) — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Transition between differing wingbeats at mid-upstroke (neutral wing), with blending over a short window — [Wu & Popović 2003](https://grail.cs.washington.edu/projects/flight/wu2003realistic.pdf)
- Banking aligns local up with the "accelerational" frame (gravity plus centripetal), i.e. a coordinated turn; reversing the bank gives a cartoony look — [Reynolds 1987](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/)
- Bank-rate dynamics driven by lateral acceleration, with separate roll-in and roll-out weights and a restoring tendency to level — [Hemelrijk & Hildenbrandt 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- Banking costs lift, so a turning flock briefly loses altitude — [Hemelrijk & Hildenbrandt 2011](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)
- Intermittent flight: flap-glide at low speed, flap-bound at higher speed (starlings do both), and the flapping fraction falls with speed — [Tobalske 2001 (snippet)](https://bioone.org/journals/american-zoologist/volume-41/issue-2/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2/Morphology-Velocity-and-Intermittent-Flight-in-Birds1/10.1668/0003-1569(2001)041[0177:MVAIFI]2.0.CO;2.full)
- Hobbyist rule set: random per-bird phase, mirrored wings, roll scaled by turn sharpness, harder flapping when climbing, glide when descending — [Godot devlog (snippet)](https://alexlaverty.github.io/blog/building-a-bird-from-boxes/)
- V-formation followers flap in spatial phase (diagonal) or near spatial anti-phase (directly behind) — [Portugal et al. 2014](https://biology2.web.ox.ac.uk/node/4076641)

### Inferences
*All code below is ILLUSTRATIVE: my synthesis of the cited principles, not taken verbatim from any source except where noted. Constants are placeholders to tune.*

1. **Per-boid state (fits in one RGBA float texel, or instanced attributes):** phase φ, flap amplitude A (smoothed), bank angle β (smoothed), glide timer or state. three.js already packs φ into `position.w`. A second texture or the velocity `.w` can hold β, and A can be packed similarly.

2. **Flap rate.** Generalize three.js's phase update with a forward-acceleration term (following Usherwood's factors) and a random per-boid base:
   ```
   f      = f0_i + kV*speed + kClimb*max(vy,0) + kAcc*max(dot(accel, fwd),0) + kCrowd*crowding
   phase += 2π * f * dt * flapping      // flapping = 0 while gliding/bounding (hold or freeze phase)
   ```
   For pigeon-like birds use kV ≈ 0 (frequency roughly speed-independent per Tobalske & Dial). For starling-like birds use kV > 0 (roughly linear per Tobalske). `crowding` (neighbour count within a radius) gives the small Usherwood flock effect.

3. **Asymmetric stroke.** A cheap substitute for Wu's h(φ) is a piecewise-linear warp with downstroke fraction α (around 0.5–0.6; *not sourced, tune it*):
   ```glsl
   float p  = mod(phase, 6.2831853) / 6.2831853;           // 0..1, 0 = top of downstroke
   float pw = (p < alpha) ? 0.5 * p / alpha
                          : 0.5 + 0.5 * (p - alpha) / (1.0 - alpha);
   float ph = pw * 6.2831853;                               // warped phase φ'
   ```
   (This drops Wu's h′(0)=h′(2π)=1 smoothness condition. A smoothstep-based warp restores it if kinks are visible.)

4. **Flap and fold curves (Wu & Popović shapes, evaluated per vertex):**
   ```glsl
   // dihedral: g1, up at φ'=0 (start of downstroke), down at φ'=π
   float dihedral = mix(downAngle, upAngle, 0.5 * (1.0 + cos(ph))) * A;
   // fold/spread: g2, full span during downstroke, retract mid-upstroke
   float fold = (ph < 3.14159) ? 0.0 : 0.5 * (1.0 - cos(2.0 * ph));  // 0 = extended, 1 = max fold
   float span = mix(1.0, foldedSpan, fold);
   // apply to wing vertices: scale lateral (x) by span, rotate about body x-axis by ±dihedral (mirrored)
   ```
   With a 2-segment wing (inner arm + outer hand), have the hand lag the arm slightly in phase, or bend extra during the upstroke. This copies Wu's synchronized elbow/wrist fold and the raven's inward fold.

5. **Flap/glide/bound state machine.** Illustrative per boid, run in JS or in the velocity shader:
   - Enter **glide** (wings extended, A → small, slight positive dihedral) when descending (vy < −threshold), when speed > cruise and acceleration demand is low, or randomly for short bouts. Starling-like birds: more glide at low speed, folded-wing **bounds** (span → foldedSpan, A → 0) at high speed (Tobalske).
   - Enter **flap** when climbing, accelerating, or slowing below cruise. Raise A with climb rate (Godot rule; Usherwood amplitude effect).
   - Switch states only near mid-upstroke (wings at neutral, per Wu's blending point) and low-pass A (for example A += (A_target − A)·(1 − exp(−dt/τ))) to avoid pops.

6. **Banking.** Following Reynolds' coordinated turn: let a be the boid's acceleration, v̂ its forward unit vector, g = (0, −9.8, 0)·worldScale.
   ```
   a_lat  = a - dot(a, v̂) v̂                   // lateral (centripetal) part
   up_des = normalize(a_lat - g)               // "accelerational up"; equals world up in straight level flight
   β_des  = signed angle between world-up-projected-perpendicular-to-v̂ and up_des, about v̂
          // equivalently β_des ≈ atan2(dot(a_lat, right), |g|)
   β     += (β_des - β) * (|β_des| > |β| ? kRollIn : kRollOut) * dt   // Hemelrijk-style faster roll-in, slower roll-out
   β      = clamp(β, -βmax, βmax)
   ```
   Then build the bird matrix as yaw · pitch · roll(β), adding a roll matrix to three.js's `maty * matz`. Smooth `a` over a few frames first, because boids steering forces are noisy. Optional realism: a small sink proportional to (1 − cos β) (Hemelrijk's altitude loss) and a slightly *higher* flap amplitude on the outer wing during a turn (Wu's "asymmetric wingbeat").

7. **Per-boid phase.** Default: random φ₀ per boid (dense flocks, no phase locking documented). Optional formation mode: for a boid following a leader at streamwise distance Δx, set φ_follower ≈ φ_leader − 2π·f·Δx/U (spatial phase, diagonal slot), plus π if directly behind (Portugal). *The formula is my derivation, not a quoted equation.*

8. **Turn-wave propagation.** To get starling-like ripples in a scripted startle or turn, delay each boid's response by distance/c, with c = 20–40 m/s in world-scaled units (Attanasi). With tight topological boids this emerges partly on its own.

9. **Performance.** All per-vertex work is a few trig calls per vertex on 9 to 30 vertices per bird, and per-bird state updates belong in the existing GPGPU position/velocity passes (three.js pattern). Compute-shader binning approaches have shown about 200k low-poly boids (TouchDesigner), so thousands in WebGL are well within budget if neighbour search is spatially binned.

### Gaps
- No source gives a validated mapping from speed or acceleration to *amplitude* for flocking birds. Usherwood measured it, but I could not access the numbers.
- No sourced downstroke fraction (u_α) values for starlings or pigeons. Wu & Popović optimized it per wingbeat but did not report typical values in the extracted text.
- No sourced maximum bank angles or roll rates for starlings (StarDisplay's Table 1 was an image). βmax and the roll constants must be tuned by eye.
- No public GDC talk or shipped-game source with flap-glide state-machine code was found within the tool budget.
