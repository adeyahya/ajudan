import type { UiLang } from "@/lib/i18n";

/**
 * Built-in starters for "New doc from template" in Docs. Each has a kind (a deliverable
 * kind, labelled in Docs) and a title and body per UI language; other languages get the
 * English one. Pure data: safe in client components.
 */

export type DocTemplateKey = "quote" | "sop" | "price_list" | "meeting_notes" | "product_sheet";
export type DocTemplate = { key: DocTemplateKey; kind: string; title: Record<UiLang, string>; body: Record<UiLang, string> };

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    key: "quote",
    kind: "quote",
    title: { en: "Quote for [customer]", id: "Penawaran untuk [pelanggan]" },
    body: {
      en: `**Quote no.:** Q-001
**Date:** [date] · **Valid until:** [date]
**For:** [customer name, company, contact]

## Items

| Item | Qty | Unit price | Total |
| --- | --- | --- | --- |
| [Product or service] | 1 | Rp0 | Rp0 |
| | | **Subtotal** | Rp0 |
| | | **Tax** | Rp0 |
| | | **Total** | **Rp0** |

## Terms
- Payment: [50% upfront, 50% on delivery]
- Delivery: [when and how]
- Prices include: [what's included]

Thank you! Questions: [phone / email]
`,
      id: `**No. penawaran:** Q-001
**Tanggal:** [tanggal] · **Berlaku sampai:** [tanggal]
**Untuk:** [nama pelanggan, perusahaan, kontak]

## Rincian

| Barang/Jasa | Jml | Harga satuan | Total |
| --- | --- | --- | --- |
| [Produk atau jasa] | 1 | Rp0 | Rp0 |
| | | **Subtotal** | Rp0 |
| | | **Pajak** | Rp0 |
| | | **Total** | **Rp0** |

## Ketentuan
- Pembayaran: [DP 50%, pelunasan saat barang diterima]
- Pengiriman: [kapan dan bagaimana]
- Harga sudah termasuk: [apa saja]

Terima kasih! Pertanyaan: [telepon / email]
`,
    },
  },
  {
    key: "sop",
    kind: "sop",
    title: { en: "SOP: [task name]", id: "SOP: [nama pekerjaan]" },
    body: {
      en: `## Purpose
Why this procedure exists and what a good result looks like.

## Who
- Does it: [role]
- Checks it: [role]

## When
[Every order / every Monday / when a customer asks for a refund]

## Steps
1. [First step]
2. [Second step]
3. [Third step]

## If something goes wrong
- [Problem] → [what to do, who to tell]

## Checklist
- [ ] [Done right]
- [ ] [Customer told]
`,
      id: `## Tujuan
Kenapa prosedur ini ada dan seperti apa hasil yang baik.

## Siapa
- Yang mengerjakan: [peran]
- Yang memeriksa: [peran]

## Kapan
[Setiap pesanan / setiap Senin / saat pelanggan minta refund]

## Langkah
1. [Langkah pertama]
2. [Langkah kedua]
3. [Langkah ketiga]

## Kalau ada masalah
- [Masalah] → [yang harus dilakukan, siapa yang dikabari]

## Daftar periksa
- [ ] [Dikerjakan dengan benar]
- [ ] [Pelanggan sudah dikabari]
`,
    },
  },
  {
    key: "price_list",
    kind: "price_list",
    title: { en: "Price list [month year]", id: "Daftar harga [bulan tahun]" },
    body: {
      en: `Prices valid from [date]. All prices in Rupiah.

## [Category]

| Product | Size / variant | Price | Notes |
| --- | --- | --- | --- |
| [Product] | [variant] | Rp0 | |
| [Product] | [variant] | Rp0 | |

## [Category]

| Product | Size / variant | Price | Notes |
| --- | --- | --- | --- |
| [Product] | [variant] | Rp0 | |

## Good to know
- Reseller / bulk price: [from how many]
- Shipping: [who pays, from where]
`,
      id: `Harga berlaku mulai [tanggal]. Semua harga dalam Rupiah.

## [Kategori]

| Produk | Ukuran / varian | Harga | Catatan |
| --- | --- | --- | --- |
| [Produk] | [varian] | Rp0 | |
| [Produk] | [varian] | Rp0 | |

## [Kategori]

| Produk | Ukuran / varian | Harga | Catatan |
| --- | --- | --- | --- |
| [Produk] | [varian] | Rp0 | |

## Perlu diketahui
- Harga reseller / grosir: [mulai berapa pcs]
- Ongkir: [ditanggung siapa, dikirim dari mana]
`,
    },
  },
  {
    key: "meeting_notes",
    kind: "meeting_notes",
    title: { en: "Meeting notes [date]", id: "Notulen rapat [tanggal]" },
    body: {
      en: `**Date:** [date] · **Where:** [place / call]
**Who:** [names]

## Agenda
1. [Topic]
2. [Topic]

## Notes
- [What was said]

## Decisions
- [What we agreed]

## Next steps
- [ ] [Task] — [who], by [date]
- [ ] [Task] — [who], by [date]
`,
      id: `**Tanggal:** [tanggal] · **Tempat:** [lokasi / panggilan]
**Peserta:** [nama-nama]

## Agenda
1. [Topik]
2. [Topik]

## Catatan
- [Yang dibahas]

## Keputusan
- [Yang disepakati]

## Langkah berikutnya
- [ ] [Tugas] — [siapa], paling lambat [tanggal]
- [ ] [Tugas] — [siapa], paling lambat [tanggal]
`,
    },
  },
  {
    key: "product_sheet",
    kind: "product_sheet",
    title: { en: "[Product name]", id: "[Nama produk]" },
    body: {
      en: `**In one line:** [what it is and who it's for]

## Why customers love it
- [Benefit]
- [Benefit]
- [Benefit]

## Details
| | |
| --- | --- |
| Size / variants | [ ] |
| Material / ingredients | [ ] |
| Weight | [ ] |
| Price | Rp0 |

## How to use / care
[Short instructions]

## Questions customers ask
**[Question]?** [Answer]
`,
      id: `**Dalam satu kalimat:** [apa produknya dan untuk siapa]

## Kenapa pelanggan suka
- [Manfaat]
- [Manfaat]
- [Manfaat]

## Detail
| | |
| --- | --- |
| Ukuran / varian | [ ] |
| Bahan / komposisi | [ ] |
| Berat | [ ] |
| Harga | Rp0 |

## Cara pakai / perawatan
[Petunjuk singkat]

## Pertanyaan yang sering diajukan
**[Pertanyaan]?** [Jawaban]
`,
    },
  },
];

export function docTemplate(key: string | null | undefined) {
  return DOC_TEMPLATES.find((t) => t.key === key);
}

/** A template's title and body in the UI language. */
export function templateText(t: DocTemplate, lang: UiLang) {
  return { title: t.title[lang] ?? t.title.en, body: t.body[lang] ?? t.body.en };
}
