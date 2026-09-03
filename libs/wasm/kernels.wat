;; ============================================================
;; Wuji v3.4 - WebAssembly kernels (hand-written WAT, zero deps)
;;   fnv1a        : FNV-1a 32-bit hash (cache keys / dedupe)
;;   lang_detect  : CJK ratio language detection (1=zh 2=ja 3=ko 0=other)
;;   levenshtein  : edit distance (KB fuzzy-search suggestions)
;; JS-side fallbacks live in libs/wasm/wasm-kernels.js; if this
;; module fails to load the feature degrades gracefully.
;; ============================================================
(module
  (memory (export "memory") 1 512)
  ;; Input region [0, 16384): two 8KB slots. DP scratch from 16384 via bump allocator.
  (global $bump (mut i32) (i32.const 16384))

  ;; ---- internal: bump allocator (returns address, grows memory if needed) ----
  (func $alloc (param $size i32) (result i32)
    (local $old i32) (local $end i32)
    (local.set $old (global.get $bump))
    (local.set $end (i32.add (local.get $old) (i32.and (i32.add (local.get $size) (i32.const 3)) (i32.const -4))))
    (if (i32.gt_u (local.get $end) (i32.mul (memory.size) (i32.const 65536)))
      (then (drop (memory.grow (i32.const 4)))))
    (global.set $bump (local.get $end))
    (local.get $old))

  ;; ============================================================
  ;; FNV-1a 32
  ;; ============================================================
  (func (export "fnv1a") (param $ptr i32) (param $len i32) (result i32)
    (local $i i32) (local $h i32)
    (local.set $h (i32.const 2166136261))
    (block $done
      (loop $L
        (if (i32.ge_u (local.get $i) (local.get $len))
          (then (br $done)))
        (local.set $h (i32.mul (i32.xor (local.get $h) (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))) (i32.const 16777619)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $L)))
    (local.get $h))

  ;; ============================================================
  ;; UTF-8  Han//
  ;; ============================================================
  (func (export "lang_detect") (param $ptr i32) (param $len i32) (result i32)
    (local $i i32) (local $han i32) (local $kana i32) (local $hangul i32)
    (local $total i32) (local $b i32) (local $b2 i32)
    (block $done
      (loop $L
        (if (i32.ge_u (local.get $i) (local.get $len))
          (then (br $done)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))
        ;; skip continuation bytes (0b10xxxxxx)
        (if (i32.eq (i32.and (local.get $b) (i32.const 192)) (i32.const 128))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $L)))
  ;; total
        (if
          (i32.or
            (i32.or (i32.eq (local.get $b) (i32.const 32)) (i32.eq (local.get $b) (i32.const 9)))
            (i32.or (i32.eq (local.get $b) (i32.const 10)) (i32.eq (local.get $b) (i32.const 13))))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $L)))
        (local.set $total (i32.add (local.get $total) (i32.const 1)))
  ;; Han:  0xE4..0xE9U+4E00..U+9FFF
        (if (i32.and (i32.ge_u (local.get $b) (i32.const 228)) (i32.le_u (local.get $b) (i32.const 233)))
          (then (local.set $han (i32.add (local.get $han) (i32.const 1)))))
  ;; 0xE3  0x81..0x83U+3040..U+30FF
        (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $len))
          (then
            (if (i32.eq (local.get $b) (i32.const 227))
              (then
                (local.set $b2 (i32.load8_u (i32.add (local.get $ptr) (i32.add (local.get $i) (i32.const 1)))))
                (if (i32.and (i32.ge_u (local.get $b2) (i32.const 129)) (i32.le_u (local.get $b2) (i32.const 131)))
                  (then (local.set $kana (i32.add (local.get $kana) (i32.const 1)))))))))
  ;; 0xEA..0xEDU+AC00..U+D7AF
        (if (i32.and (i32.ge_u (local.get $b) (i32.const 234)) (i32.le_u (local.get $b) (i32.const 237)))
          (then (local.set $hangul (i32.add (local.get $hangul) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $L)))
  ;; 100
    (if (i32.eq (local.get $total) (i32.const 0))
      (then (return (i32.const 0))))
    (if (i32.gt_u (i32.div_u (i32.mul (local.get $han) (i32.const 100)) (local.get $total)) (i32.const 25))
      (then (return (i32.const 1))))
    (if (i32.gt_u (i32.div_u (i32.mul (local.get $kana) (i32.const 100)) (local.get $total)) (i32.const 15))
      (then (return (i32.const 2))))
    (if (i32.gt_u (i32.div_u (i32.mul (local.get $hangul) (i32.const 100)) (local.get $total)) (i32.const 15))
      (then (return (i32.const 3))))
    (i32.const 0))

  ;; ----  ----
  (func $min3 (param $a i32) (param $b i32) (param $c i32) (result i32)
    (local $m i32)
    (local.set $m (if (result i32) (i32.lt_u (local.get $a) (local.get $b))
      (then (local.get $a))
      (else (local.get $b))))
    (if (result i32) (i32.lt_u (local.get $m) (local.get $c))
      (then (local.get $m))
      (else (local.get $c))))

  ;; ============================================================
  ;; Levenshtein  DP
  ;; ============================================================
  (func (export "levenshtein") (param $ap i32) (param $al i32) (param $bp i32) (param $bl i32) (result i32)
    (local $prev i32) (local $cur i32) (local $rowsize i32)
    (local $i i32) (local $j i32) (local $tmp i32) (local $val i32)
  ;; internal: bump allocator
    (global.set $bump (i32.const 16384))
    (if (i32.eq (local.get $al) (i32.const 0))
      (then (return (local.get $bl))))
    (if (i32.eq (local.get $bl) (i32.const 0))
      (then (return (local.get $al))))
    (local.set $rowsize (i32.mul (i32.add (local.get $bl) (i32.const 1)) (i32.const 4)))
    (local.set $prev (call $alloc (local.get $rowsize)))
    (local.set $cur (i32.add (local.get $prev) (local.get $rowsize)))
    ;; prev[j] = j
    (local.set $j (i32.const 0))
    (block $initdone
      (loop $init
        (if (i32.gt_u (local.get $j) (local.get $bl))
          (then (br $initdone)))
        (i32.store (i32.add (local.get $prev) (i32.mul (local.get $j) (i32.const 4))) (local.get $j))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $init)))
  ;; 
    (local.set $i (i32.const 1))
    (block $outerdone
      (loop $outer
        (if (i32.gt_u (local.get $i) (local.get $al))
          (then (br $outerdone)))
        (i32.store (local.get $cur) (local.get $i))
        (local.set $j (i32.const 1))
        (block $innerdone
          (loop $inner
            (if (i32.gt_u (local.get $j) (local.get $bl))
              (then (br $innerdone)))
            ;; cost = a[i-1] == b[j-1] ? 0 : 1
            (local.set $val
              (if (result i32)
                (i32.eq
                  (i32.load8_u (i32.add (local.get $ap) (i32.sub (local.get $i) (i32.const 1))))
                  (i32.load8_u (i32.add (local.get $bp) (i32.sub (local.get $j) (i32.const 1)))))
                (then (i32.const 0))
                (else (i32.const 1))))
            ;; val = min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
            (local.set $val
              (call $min3
                (i32.add (i32.load (i32.add (local.get $cur) (i32.mul (i32.sub (local.get $j) (i32.const 1)) (i32.const 4)))) (i32.const 1))
                (i32.add (i32.load (i32.add (local.get $prev) (i32.mul (local.get $j) (i32.const 4)))) (i32.const 1))
                (i32.add (i32.load (i32.add (local.get $prev) (i32.mul (i32.sub (local.get $j) (i32.const 1)) (i32.const 4)))) (local.get $val))))
            (i32.store (i32.add (local.get $cur) (i32.mul (local.get $j) (i32.const 4))) (local.get $val))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner)))
        ;; __ prev/cur
        (local.set $tmp (local.get $prev))
        (local.set $prev (local.get $cur))
        (local.set $cur (local.get $tmp))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))
    (i32.load (i32.add (local.get $prev) (i32.mul (local.get $bl) (i32.const 4)))))
)
