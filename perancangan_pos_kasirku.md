# Perancangan Sistem Point of Sales (POS) - KASIRKU

**"Solusi Kasir Sederhana untuk Bisnis Anda"**

## 1. IDENTITAS PROJECT

* **Mata Kuliah:** Pemrograman Web II

* **Topik:** Sistem Point of Sales (POS / Kasir Toko)

* **Nama Aplikasi:** KASIRKU

* **Platform:** Web

* **Target pengguna:** Admin dan Kasir

* **Teknologi tahap implementasi:** HTML5, CSS3, Vanilla JavaScript (DOM & LocalStorage)

* **UI/UX:** Google Stitch dan Figma

**Deskripsi Singkat:**
KASIRKU merupakan aplikasi *Point of Sales* (POS) berbasis web yang dirancang dengan antarmuka sederhana dan intuitif. Aplikasi ini bertujuan untuk membantu pemilik toko (Admin) dan staf (Kasir) dalam mengelola transaksi penjualan, data produk, ketersediaan stok, data pelanggan, hingga melihat riwayat laporan penjualan secara digital, mudah, dan cepat.

## 2. TUJUAN SISTEM

Tujuan dari pengembangan sistem KASIRKU adalah:

1. Mempermudah dan mempercepat proses transaksi penjualan di meja kasir.

2. Mengurangi kesalahan perhitungan dan pencatatan transaksi secara manual.

3. Membantu admin mengelola data produk, kategori, dan stok secara *real-time* (tersentralisasi).

4. Menyediakan riwayat transaksi yang rapi untuk keperluan audit toko.

5. Menyediakan laporan penjualan dan laporan stok sederhana untuk evaluasi bisnis.

6. Menciptakan *user experience* yang ramah bagi pengguna awam.

## 3. TARGET PENGGUNA DAN ROLE

Sistem ini memiliki dua peran utama dengan hak akses yang disesuaikan dengan tanggung jawab masing-masing.

| Role | Fitur | Hak Akses | 
 | ----- | ----- | ----- | 
| **Admin** | Dashboard | Melihat ringkasan data (Total penjualan, produk, stok) | 
|  | Master Data (Produk, Kategori, Stok, Pelanggan) | *Create, Read, Update, Delete* (CRUD) penuh | 
|  | Transaksi | Hanya melihat (*Read*) riwayat transaksi | 
|  | Laporan | Melihat dan mencetak (*Read & Print*) laporan penjualan & stok | 
|  | Pengaturan (Pengguna & Toko) | CRUD data kasir dan mengubah profil toko | 
| **Kasir** | Dashboard | Melihat ringkasan aktivitas kasir hari ini | 
|  | Kasir / Transaksi | Memasukkan produk ke keranjang, memproses pembayaran, mencetak struk (*Create & Read*) | 
|  | Master Data Produk | Hanya melihat katalog produk (*Read*) | 
|  | Transaksi | Melihat riwayat transaksi mandiri (*Read*) | 
|  | Pengaturan | Hanya mengubah profil dan password sendiri | 

## 4. STRUKTUR MENU / SITEMAP

### Hierarki Menu

* **MAIN**

  * Dashboard

  * Kasir / Transaksi

* **MASTER DATA**

  * Produk

  * Kategori

  * Stok

  * Pelanggan

* **TRANSAKSI**

  * Riwayat Transaksi

* **LAPORAN**

  * Laporan Penjualan

  * Laporan Stok

* **PENGATURAN**

  * Pengguna / Kasir

  * Pengaturan Toko

* **AKUN**

  * Profil Pengguna

  * Logout

### Sitemap Diagram (Mermaid)

```
flowchart TD
    Login[Halaman Login] --> MainLayout[Layout Utama Aplikasi]
    
    MainLayout --> MAIN[Main Menu]
    MainLayout --> MASTER[Master Data]
    MainLayout --> TRANS[Transaksi]
    MainLayout --> LAP[Laporan]
    MainLayout --> PENG[Pengaturan]
    MainLayout --> AKUN[Menu Akun]

    MAIN --> Dash[Dashboard]
    MAIN --> POS[Kasir / Transaksi]

    MASTER --> Prod[Produk]
    MASTER --> Kat[Kategori]
    MASTER --> Stok[Stok]
    MASTER --> Pel[Pelanggan]

    TRANS --> Riwayat[Riwayat Transaksi]

    LAP --> LapJual[Laporan Penjualan]
    LAP --> LapStok[Laporan Stok]

    PENG --> Pengguna[Pengguna / Kasir]
    PENG --> Toko[Pengaturan Toko]

    AKUN --> Profil[Profil Pengguna]
    AKUN --> Logout[Logout]

```

## 5. USER FLOW

**Flow Utama: Transaksi Kasir**

 1. User masuk ke halaman **Login**, memasukkan *username* dan *password*.

 2. Sistem memvalidasi role (Kasir).

 3. User dialihkan ke halaman **Dashboard**.

 4. User mengklik menu **Kasir / Transaksi**.

 5. User mencari produk melalui *search bar* atau memindai/memilih dari daftar produk.

 6. User menambahkan produk ke *Cart* (Keranjang).

 7. User menyesuaikan kuantitas (Qty) barang.

 8. User menekan tombol **Bayar**.

 9. Muncul *Modal/Pop-up* pembayaran untuk memasukkan nominal uang tunai yang diterima.

10. Sistem menghitung kembalian.

11. User menekan tombol **Selesaikan Transaksi**.

12. Stok produk berkurang otomatis, transaksi tersimpan di riwayat.

13. User mencetak struk belanja.

## 6. KONSEP ERD SEDERHANA

Karena proyek ini akan diimplementasikan menggunakan struktur data sederhana (seperti JSON/LocalStorage di JS), berikut adalah gambaran relasi antar entitas datanya:

```
erDiagram
    USERS {
        string id PK
        string nama
        string username
        string password
        string role "Admin / Kasir"
    }
    CATEGORIES {
        string id PK
        string nama_kategori
    }
    PRODUCTS {
        string id PK
        string category_id FK
        string nama_produk
        int harga_jual
        int harga_beli
        int stok
    }
    CUSTOMERS {
        string id PK
        string nama_pelanggan
        string no_hp
    }
    TRANSACTIONS {
        string id PK
        string user_id FK
        string customer_id FK
        datetime tanggal
        int total_harga
        int nominal_bayar
        int kembalian
    }
    TRANSACTION_DETAILS {
        string id PK
        string transaction_id FK
        string product_id FK
        int qty
        int subtotal
    }

    USERS ||--o{ TRANSACTIONS : "melakukan"
    CUSTOMERS ||--o{ TRANSACTIONS : "memiliki"
    CATEGORIES ||--|{ PRODUCTS : "mengelompokkan"
    PRODUCTS ||--o{ TRANSACTION_DETAILS : "termasuk_dalam"
    TRANSACTIONS ||--|{ TRANSACTION_DETAILS : "memiliki_detail"

```

## 7. PENJELASAN SETIAP ENTITAS DATABASE

1. **USERS**: Menyimpan data pengguna aplikasi (Admin & Kasir) untuk keperluan autentikasi (login) dan pencatatan kasir yang bertugas.

2. **CATEGORIES**: Mengelompokkan produk (misal: Minuman, Makanan Ringan, Alat Tulis) agar mudah dicari di menu Kasir.

3. **PRODUCTS**: Menyimpan detail barang yang dijual, termasuk harga dan jumlah stok saat ini. Terhubung dengan entitas *Categories*.

4. **CUSTOMERS**: (Opsional digunakan saat transaksi) Menyimpan data pelanggan member jika diperlukan pencatatan siapa yang membeli.

5. **TRANSACTIONS**: Header transaksi. Menyimpan ringkasan penjualan seperti waktu transaksi, kasir yang melayani, total harga, uang yang dibayarkan, dan kembalian.

6. **TRANSACTION_DETAILS**: Detail keranjang belanja dari suatu transaksi. Mencatat spesifik barang apa saja yang dibeli, jumlahnya (*qty*), dan subtotal harga per barang pada transaksi tersebut.

## 8. DESIGN SYSTEM

Konsep UI/UX KASIRKU difokuskan pada kebersihan, kejelasan huruf, dan area interaksi yang luas (mendukung *touchscreen* untuk tablet kasir).

* **Typography**: *Inter* atau *Roboto* (Sederhana, bersih, mudah dibaca pada ukuran kecil).

* **Color Palette**:

  * *Primary*: Biru (Kepercayaan, profesional - `#0d6efd`)

  * *Secondary*: Abu-abu terang (Background aplikasi - `#f8f9fa`)

  * *Success*: Hijau (Tombol Bayar, notifikasi berhasil - `#198754`)

  * *Danger*: Merah (Tombol Hapus, notifikasi error - `#dc3545`)

  * *Dark*: Hitam/Abu-abu gelap (Teks utama - `#212529`)

* **Layouting**: CSS Flexbox dan CSS Grid (Mempermudah pembuatan struktur layout *Sidebar* dan area *Cart* di halaman POS).

## 9. DAFTAR HALAMAN UI

1. **Halaman Login**: Form input username dan password.

2. **Halaman Dashboard**: Menampilkan *Summary Card* (Total Penjualan, Jumlah Transaksi, dll) dan grafik sederhana (opsional).

3. **Halaman POS (Kasir)**: Halaman utama operasional dengan daftar produk (kiri) dan *shopping cart* / setruk belanja (kanan).

4. **Halaman Data Produk/Kategori/Stok/Pelanggan**: Berisi tabel data (CRUD) dengan tombol Tambah, Edit, dan Hapus.

5. **Halaman Riwayat Transaksi**: Tabel daftar transaksi yang sudah selesai beserta opsi untuk melihat detail struk.

6. **Halaman Pengaturan**: Form untuk mengedit profil toko dan manajemen akun pengguna.

## 10. DAFTAR KOMPONEN UI

Komponen HTML/CSS yang akan sering di-*reuse*:

* **Sidebar & Navbar**: Navigasi utama aplikasi.

* **Product Card**: Kartu kecil berisi gambar/icon produk, nama, dan harga (untuk di halaman POS).

* **Data Table**: Tabel standar dengan fitur paginasi dan pencarian (untuk master data).

* **Modal (Pop-up)**: Digunakan untuk form tambah/edit data, dan popup kalkulasi kembalian uang kasir.

* **Alert/Toast Notification**: Pesan pop-up kecil di pojok layar (contoh: "Produk berhasil ditambahkan!").

* **Form Inputs & Buttons**: Standar input text, number, select dropdown, dan tombol aksi (Submit, Cancel, Delete).

## 11. LINK PROJECT FIGMA

Desain UI/UX dapat dilihat melalui tautan Figma berikut:
https://www.figma.com/design/a7MpIxLgKewbwxuOjdMaG1/POS?node-id=0-1&p=f&t=mAp8nqwMJ84geJEK-0

## 12. HASIL RANCANGAN (SCREENSHOT)

*(Disini tempat SS nanti)*

* `![Dashboard](link-gambar-dashboard.png)`

* `![Halaman Kasir](link-gambar-pos.png)`

* `![Master Data](link-gambar-master.png)`

## 13. CATATAN IMPLEMENTASI UNTUK TAHAP CODING

Mengingat batasan proyek ini sebagai tugas dasar Pemrograman Web II (Tanpa *backend* dan *framework* besar):

1. **Database Mockup (Penyimpanan Data):**
   Karena tidak menggunakan database SQL seperti MySQL, seluruh entitas data (Users, Products, Transactions) akan disimpan menggunakan **`Window.localStorage`** di dalam browser menggunakan format JSON.

2. **State Management & DOM:**
   Manipulasi antarmuka (menambah barang ke keranjang, merender tabel) akan sepenuhnya menggunakan **Vanilla JavaScript** (DOM Manipulation / `document.getElementById` atau `document.querySelector`).

3. **Keamanan Sederhana:**
   Login bersifat simulasi. *Role base access* akan diatur dengan mengecek variabel `role` pada *session/local storage*. Jika Kasir mencoba membuka file `produk.html`, JavaScript akan melakukan *redirect* otomatis kembali ke dashboard.

4. **Responsiveness:**
   Desain diprioritaskan untuk layar Desktop dan Tablet (sering digunakan di mesin kasir), namun akan ditambahkan *media-queries* dasar agar tetap terlihat rapi di layar *mobile*.

5. **Struktur File:**

   * `index.html` (Login)

   * `/pages/...` (Folder halaman seperti pos.html, produk.html)

   * `/assets/css/style.css` (Styling utama)

   * `/assets/js/app.js` (Logika utama POS)

   * `/assets/js/db.js` (Logika inisiasi *LocalStorage* palsu)