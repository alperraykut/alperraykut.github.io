# AdMob Kazanç Paneli

Kişisel, salt-okunur AdMob kazanç paneli. Telefonda Safari'de açıp **Paylaş → Ana Ekrana Ekle** ile uygulama gibi kullanılır.

- Veri: AdMob API v1 (`networkReport:generate`), yalnızca okuma izni (`admob.readonly`).
- Giriş: Google OAuth, tamamen tarayıcıda. Sunucu yok, şifre ya da gizli anahtar yok.
- `config.js` içindeki `CLIENT_ID` boşsa uygulama örnek verilerle açılır.
- Saatlik dağılım ve kullanıcı sayıları AdMob API'de yok; oyunlara Firebase Analytics eklenince bağlanacak.
