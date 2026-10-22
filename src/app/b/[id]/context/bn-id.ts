import { en as bnEn } from "@blocknote/core/locales";

/**
 * BlockNote has no Indonesian: the parts of the editor's UI the owner sees (slash menu,
 * placeholders, block handles, table handles, formatting toolbar, links), merged over
 * the English dictionary so anything not listed stays English.
 */

type Dict = typeof bnEn;
type Slash = Dict["slash_menu"][keyof Dict["slash_menu"]];

const G = { heading: "Judul", basic: "Blok dasar", advanced: "Lanjutan", media: "Media", other: "Lainnya" };

const slash = (title: string, subtext: string, group: string, aliases: string[]): Partial<Slash> => ({ title, subtext, group, aliases });

const SLASH_ID: Partial<Record<keyof Dict["slash_menu"], Partial<Slash>>> = {
  heading: slash("Judul 1", "Judul utama", G.heading, ["judul", "judul1"]),
  heading_2: slash("Judul 2", "Judul bagian", G.heading, ["judul2", "subjudul"]),
  heading_3: slash("Judul 3", "Judul subbagian", G.heading, ["judul3", "subjudul"]),
  heading_4: slash("Judul 4", "Judul kecil", G.heading, ["judul4"]),
  heading_5: slash("Judul 5", "Judul lebih kecil", G.heading, ["judul5"]),
  heading_6: slash("Judul 6", "Judul terkecil", G.heading, ["judul6"]),
  quote: slash("Kutipan", "Kutipan atau cuplikan", G.basic, ["kutipan", "kutip"]),
  numbered_list: slash("Daftar bernomor", "Daftar dengan urutan", G.basic, ["daftar", "nomor", "urut"]),
  bullet_list: slash("Daftar poin", "Daftar tanpa urutan", G.basic, ["daftar", "poin", "butir"]),
  check_list: slash("Daftar centang", "Daftar dengan kotak centang", G.basic, ["centang", "tugas", "todo", "ceklis"]),
  paragraph: slash("Teks", "Paragraf biasa", G.basic, ["teks", "paragraf"]),
  code_block: slash("Blok kode", "Kode dengan pewarnaan sintaks", G.basic, ["kode"]),
  page_break: slash("Pemisah halaman", "Pindah ke halaman baru saat dicetak", G.basic, ["pemisah", "halaman"]),
  divider: slash("Garis pemisah", "Pisahkan blok dengan garis", G.basic, ["garis", "pemisah"]),
  table: slash("Tabel", "Tabel dengan sel yang bisa diubah", G.advanced, ["tabel"]),
  image: slash("Gambar", "Gambar dengan keterangan", G.media, ["gambar", "foto"]),
  video: slash("Video", "Video dengan keterangan", G.media, ["video"]),
  audio: slash("Audio", "Audio dengan keterangan", G.media, ["audio", "suara"]),
  file: slash("Berkas", "Sematkan berkas", G.media, ["berkas", "file"]),
  emoji: slash("Emoji", "Cari dan sisipkan emoji", G.other, ["emoji"]),
};

/** The editor's dictionary for a UI language, with our placeholder. */
export function editorDictionary(lang: "en" | "id", placeholder: string): Dict {
  if (lang !== "id") return { ...bnEn, placeholders: { ...bnEn.placeholders, default: placeholder, emptyDocument: placeholder } };
  const slashMenu = Object.fromEntries(
    Object.entries(bnEn.slash_menu).map(([k, v]) => {
      const id = SLASH_ID[k as keyof Dict["slash_menu"]];
      // English aliases still work after the Indonesian ones.
      return [k, id ? { ...v, ...id, aliases: [...(id.aliases ?? []), ...v.aliases] } : v];
    }),
  ) as Dict["slash_menu"];
  return {
    ...bnEn,
    slash_menu: slashMenu,
    placeholders: { ...bnEn.placeholders, default: placeholder, emptyDocument: placeholder, heading: "Judul", toggleListItem: "Lipat", bulletListItem: "Daftar", numberedListItem: "Daftar", checkListItem: "Daftar" },
    side_menu: { add_block_label: "Tambah blok", drag_handle_label: "Buka menu blok" },
    drag_handle: { ...bnEn.drag_handle, delete_menuitem: "Hapus", colors_menuitem: "Warna", header_row_menuitem: "Baris judul", header_column_menuitem: "Kolom judul" },
    table_handle: {
      ...bnEn.table_handle,
      delete_column_menuitem: "Hapus kolom",
      delete_row_menuitem: "Hapus baris",
      add_left_menuitem: "Tambah kolom di kiri",
      add_right_menuitem: "Tambah kolom di kanan",
      add_above_menuitem: "Tambah baris di atas",
      add_below_menuitem: "Tambah baris di bawah",
      split_cell_menuitem: "Pisahkan sel",
      merge_cells_menuitem: "Gabungkan sel",
      background_color_menuitem: "Warna latar",
    },
    suggestion_menu: { no_items_title: "Tidak ada yang cocok" },
    color_picker: {
      text_title: "Teks",
      background_title: "Latar",
      colors: { default: "Otomatis", gray: "Abu-abu", brown: "Cokelat", red: "Merah", orange: "Oranye", yellow: "Kuning", green: "Hijau", blue: "Biru", purple: "Ungu", pink: "Merah muda" },
    },
    formatting_toolbar: {
      ...bnEn.formatting_toolbar,
      bold: { ...bnEn.formatting_toolbar.bold, tooltip: "Tebal" },
      italic: { ...bnEn.formatting_toolbar.italic, tooltip: "Miring" },
      underline: { ...bnEn.formatting_toolbar.underline, tooltip: "Garis bawah" },
      strike: { ...bnEn.formatting_toolbar.strike, tooltip: "Coret" },
      code: { ...bnEn.formatting_toolbar.code, tooltip: "Kode" },
      colors: { tooltip: "Warna" },
      link: { ...bnEn.formatting_toolbar.link, tooltip: "Buat tautan" },
      nest: { ...bnEn.formatting_toolbar.nest, tooltip: "Masukkan ke dalam" },
      unnest: { ...bnEn.formatting_toolbar.unnest, tooltip: "Keluarkan" },
      align_left: { tooltip: "Rata kiri" },
      align_center: { tooltip: "Rata tengah" },
      align_right: { tooltip: "Rata kanan" },
      align_justify: { tooltip: "Rata kiri-kanan" },
      table_cell_merge: { tooltip: "Gabungkan sel" },
    },
    link_toolbar: {
      ...bnEn.link_toolbar,
      delete: { tooltip: "Hapus tautan" },
      edit: { text: "Ubah tautan", tooltip: "Ubah" },
      open: { tooltip: "Buka di tab baru" },
      form: { title_placeholder: "Ubah judul", url_placeholder: "Ubah URL" },
    },
  };
}
