# Amiral AI Orkestrasyon Ekibi

[English](./README.md) | [Türkçe](./README_TR.md)

![AMIRAL_Logo](./assets/amiral-ai.png)

Amiral, [OpenCode](https://opencode.ai/) için kalıcı ve bağımlılıkların farkında olan çok ajanlı bir mühendislik iş akışıdır. `amiral` CLI; işi planlar, görevleri yalıtılmış Git worktree'lerinde uzman ajanlara atar, sonuçlarını entegre eder ve bağımsız inceleme ile QA geçitlerini zorunlu kılar.

## En önemli ayrım: `plan` çalıştırma yapmaz

> **`amiral plan`, yeniden kullanılabilir bir plan oluşturup doğrular, bunu `plans/` altına yazar, plan kimliğini ekrana basar ve çıkar. Bilerek bir iş akışı oluşturmaz veya çalıştırmaz.**
>
> **Çalıştırmayı `amiral run` yapar.** Bir istek verildiğinde önce planlar, ardından bir iş akışı oluşturup çalıştırır. Ayrıca kaydedilmiş bir planı çalıştırabilir veya kalıcı duruma yazılmış bir iş akışını sürdürebilir.

Amacınıza göre komutu seçin:

| Yapmak istediğiniz... | Kullanım |
| --- | --- |
| Herhangi bir uygulama başlamadan önce görev grafiğini incelemek veya onaylamak | `amiral plan "Add authentication"` |
| Onaylanan planı çalıştırmak | `amiral run --plan feature-ab12cd34` |
| Tek komutta planlamak ve çalıştırmak | `amiral run "Add authentication"` |
| Kesintiye uğramış, duraklatılmış veya yeniden denenmiş bir iş akışını sürdürmek | `amiral run --workflow feature-ab12cd34` |
| Şu anda seçili iş akışını sürdürmek | `amiral run` |

```bash
# İki adımlı, çalıştırmadan önce incelemeli akış
amiral plan "Add authentication" --type feature
# Çıktı şunu içerir: Plan created: feature-ab12cd34
amiral run --plan feature-ab12cd34

# Tek adımlı akış: aynı istek planlanır ve ardından çalıştırılır
amiral run "Add authentication" --type feature
```

`run` üzerindeki `--plan`, `plans/` altındaki bir plan kimliğini veya mevcut bir plan/grafik dosyasını kabul eder. Plan oluşturmasını bekleyerek `amiral run --plan ...` kullanmayın; bu seçenek mevcut bir planı tüketir.

## Ön koşullar

- Node.js **20 veya daha yeni bir sürüm** ve npm.
- Hedef dizin depo olarak başlatılmış şekilde Git. `amiral init` hiçbir zaman `git init` çalıştırmaz.
- Yapılandırılmış sağlayıcı CLI'sı. Birlikte verilen yapılandırma `opencode` çalıştırılabilir dosyasını kullanır; bunu kurun, OpenCode talimatlarına göre kimlik doğrulaması yapın ve `PATH` üzerinde bulunduğundan emin olun.
- Entegrasyondan önce temiz bir çalışma ağacı. Amiral ilgisiz kullanıcı değişikliklerini korur ve kirli bir ağaca entegrasyon yapmaz.
- OpenCode kurulumunuza uygun sağlayıcı erişimi, modeller ve kimlik bilgileri. İzlenen yapılandırmaya gizli bilgi koymayın.

Başlatmanın ardından `amiral doctor` ve `amiral config validate` ile hazır olduğunuzu doğrulayın.

## Kurulum ve çağırma

### Global kurulum

```bash
npm install --global amiral-ai
amiral --version
amiral --help
```

### Projeye yerel kurulum

```bash
npm install --save-dev amiral-ai
npx amiral --version
```

Örneğin `"amiral": "amiral"` şeklinde bir paket betiği de ekleyebilir, ardından `npm run amiral -- status` çalıştırabilirsiniz.

### Kurmadan çalıştırma

```bash
npx --yes amiral-ai --version
npx --yes amiral-ai init --minimal
```

`npm run build` yalnızca bu depoyu geliştirmek içindir; yayımlanmış paket kurulduktan sonra gerekli değildir. Yerel kurulumda projeye yerel ikili dosyanın kullanılması için `npx amiral` tercih edin. Yerel kurulum yoksa `npx amiral-ai ...`, npm paketini açıkça belirtir.

### Paketi ve sürümü doğrulama

```bash
amiral --version                         # etkin global/PATH ikili dosyası
npx amiral --version                     # kurulu olduğunda yerel ikili dosya
npm view amiral-ai version               # güncel registry sürümü
npm list amiral-ai                       # yerel kurulu sürüm
npm list --global amiral-ai              # global kurulu sürüm
```

Paket sürümü, kurulu `package.json` dosyasından okunur; bu depo şu anda **0.1.2** sürümünü bildirir. Yükseltmeden sonra hâlâ eski bir sürüm gösteriliyorsa hangi çalıştırılabilir dosyanın çözümlendiğini belirleyin (Windows'ta `where amiral`, macOS/Linux'ta `which -a amiral`), çakışan global/yerel kurulumları kaldırın, yalnızca npm bozulma bildirdiyse npm'in normal önbelleğini temizleyin ve yeniden kurun. Eski bir global ikili dosyayı daha yeni bir yerel paketle düşünmeden birlikte kullanmaktan kaçının.

```bash
npm update --save-dev amiral-ai           # yerel bağımlılığı kendi sürüm aralığında güncelle
npm install --global amiral-ai@latest     # global paketi değiştir
npx --yes amiral-ai@latest --version      # registry'deki en son sürümü açıkça kullan
```

CLI'ı yeniden kurmak proje çalışma zamanı durumunu taşımaz veya silmez. Daha yeni bir CLI'ı mevcut `tasks/` verileriyle kullanmadan önce sürüm değişikliklerini inceleyin.

## Bir projeyi başlatma

Başlatmayı amaçlanan proje kökünde çalıştırın:

```bash
git init                                  # yalnızca burası henüz bir Git deposu değilse
amiral init --minimal
amiral doctor
amiral config validate
```

```text
amiral init [--minimal] [--force]
```

- `--minimal`: yalnızca `team.yaml`, iş akışı tanımları, şemalar ve makine planlama ajanını kurar.
- `--force`: mevcut şablon dosyalarının üzerine yazar. Dikkatli kullanın; bu seçenek olmadan mevcut dosyalar korunur.

Tam başlatma, `team.yaml` ve `.opencode/` içindeki izin listesindeki şablonları (ajanlar, iş akışları, sözleşmeler, orkestrasyon, politikalar, istemler, şemalar ve OpenCode yapılandırması) kurar. Başlatma ayrıca `.gitignore` dosyasına işaretçilerle sınırlanmış bir Amiral bloğu ekler; bloğu çoğaltmaz ve blok dışındaki içeriğin üzerine yazmaz. Güvenli olmayan sembolik bağlantı hedeflerini reddeder ve hiçbir zaman paket manifestlerini, bağımlılıkları veya çalışma zamanı durumunu kurmaz.

## Proje kökünü bulma

`init` dışında komutlar, boşluk içeren yollar da dahil olmak üzere proje kökünde veya herhangi bir alt dizinde çalıştırılabilir. Amiral yukarı doğru ilerler:

1. `team.yaml` içeren en yakın üst dizin seçilir.
2. `team.yaml` bulunamazsa `.amiral` veya `.opencode` içeren ilk üst dizin yedek olarak kullanılır.
3. Hiçbiri yoksa komut başarısız olur ve `amiral init` önerir.

İşlem daha sonra bulunan kökten yürütülür. `doctor` özeldir: Amiral kökü bulunmasa bile geçerli dizini teşhis edebilir; `doctor --fix` burada eksik destek dizinlerini/minimal dosyaları oluşturabilir.

## İstekler: konumsal `goal` ile `--request` karşılaştırması

Kullanıcının eksiksiz özgün isteği, planlamanın esas girdisidir.

- Normal kullanımda isteğin tamamı için konumsal `[goal]` kullanın.
- Konumsal hedef yalnızca kısa bir başlıksa tüm gereksinimleri `--request` içine koyun.
- İkisi de verilirse boş olmayan `--request`, eksiksiz ve esas istektir; kısa hedef buna eklenmez.
- `--request` yoksa `goal`, eksiksiz istek olur.
- `--plan-file` bir planı içe aktarır; dolayısıyla iki metin argümanından birini gerektirmez.

```bash
# İsteğin tamamı konumsal argümanda
amiral plan "Add password reset with expiring one-use tokens and integration tests"

# Kısa, gösterim düzeyinde fikir ve eksiksiz esas istek
amiral run "Password reset" \
  --request "Add email-based password reset. Tokens expire after 15 minutes, are one-use, and must be covered by integration tests." \
  --type feature
```

Shell tırnaklaması önemlidir. Boşluk içeren istekleri tırnak içine alın; uzun istekler için shell'inizin satır sürdürme sözdizimini veya tek satır kullanın. Shell'ler ve işlem araçları kaydedebileceğinden komut argümanlarına gizli bilgi koymayın.

## Çalışma modeli

```text
Kullanıcı isteği
    ↓
Lead / iş akışı seçimi
    ↓
Planner → doğrulanmış bağımlılık grafiği
    ↓
Yalıtılmış Git worktree'lerindeki uzmanlar
    ↓
Entegrasyon worktree'si
    ↓
Reviewer ── CHANGES_REQUESTED → düzeltme görevleri → yeniden inceleme
    ↓ PASS
QA ──────── FAIL/BLOCKED → girdi için dur
    ↓ PASS
Tamamlandı
```

Temel ilkeler:

- Mimari kararlar vermeden önce mevcut depoyu inceleyin; mevcut kuralları izleyin.
- Tek orkestrasyon yetkilisi Lead'dir. Planner analiz eder ve ayrıştırır ancak uygulama yapmaz.
- Frontend, backend, database ve DevOps uzmanları yalnızca atanan işi uygular.
- Bir görev ancak tüm bağımlılıkları tamamlandığında zamanlanabilir. Bağımsız görevler yalnızca yapılandırılmış sağlayıcı/ajan kapasitesi içinde ve güvenliyse eşzamanlı çalışabilir.
- İş, görev worktree'lerinde yalıtılır ve entegrasyon worktree'sine idempotent biçimde birleştirilir.
- Reviewer ve QA bağımsız geçitlerdir. Önemsiz olmayan bir iş akışı ancak uygulama, entegrasyon, inceleme `PASS` ve QA `PASS` sonrasında tamamlanır.
- İncelemedeki `CHANGES_REQUESTED`, `quality.max_review_rounds` sınırına kadar düzeltme görevleri oluşturur; engellenen/tükenen geçitler sahte başarıya dönüşmez.
- İlgisiz değişiklikleri koruyun, yıkıcı Git eylemlerinden kaçının ve kimlik bilgilerini asla açığa çıkarmayın.

Birlikte verilen `team.yaml`; ajanları, yetenekleri, sağlayıcı yönlendirmesi/kapasitesini, kiralamaları, yeniden denemeleri, Git saklama ayarlarını ve `feature`, `bugfix`, `refactor` iş akışlarını tanımlar. Zamanlayıcı görev bağımlılıklarını ve gerekli yetenekleri kullanır; etkin paralellik `execution.max_parallel_agents` ve sağlayıcı eşzamanlılığıyla sınırlıdır (birlikte verilen yapılandırmada her ikisinin varsayılanı da 1'dir).

## Global bayraklar ve çıktı

Bu bayraklar alt komuttan önce veya sonra yer alabilir; bildirildiği yerlerde komuta özel `--json`/`--verbose` biçimleri de kabul edilir.

| Bayrak | Anlamı |
| --- | --- |
| `-q, --quiet` | Standart çıktı oluşturucuyu kullanan komutlarda normal çıktıyı bastırır. `config path` ve JSON olmayan `config show` şu anda doğrudan stdout'a yazar. |
| `-v, --verbose` | Desteklendiği yerlerde tanılama/ilerleme olaylarını dahil eder. |
| `--json` | Başarılı komut çıktısı için tek bir JSON belgesi üretir. |
| `-V, --version` | Paket sürümünü yazdırır. |
| `-h, --help` | Yardımı gösterir; kapsama özel yardım için herhangi bir komut/alt komuttan sonra kullanın. |

Otomasyon için `--json` kullanın ve çıkış kodunu denetleyin:

```bash
amiral --json status > status.json
amiral doctor --json > doctor.json
amiral config show --json > config.json       # gizli bilgi benzeri anahtarlar maskelenir
amiral workflow list --json
```

Normal JSON çıktısı stdout'a tek belge olarak gider. Hatalar stderr'e gider; JSON kipinde biçimleri `{"error":{"message":"...","code":N}}` şeklindedir. stdout ayrıştırılabilir kalsın diye JSON üreten planlama/run/geçit komutlarında ayrıntılı sağlayıcı ilerlemesi bastırılır. Belgelenen yerlerde etkileşimli komutlar, TTY olmayan otomasyonda yine `--force` gerektirir.

`doctor` bir tanılama istisnasıdır: bazı denetimler başarısız olsa bile denetimlerini tamamladıktan sonra şu anda `0` ile çıkar. Otomasyon JSON `failures` sayısını veya her `checks[].state` değerini incelemelidir; yalnızca çıkış kodunu hazırlık sonucu saymayın.

Çıkış kodları kararlı CLI kategorileridir:

| Kod | Anlamı |
| ---: | --- |
| 0 | Başarı; `run` zamanlanmış geçici bir yeniden deneme için durakladığında da kullanılır. |
| 1 | Genel başarısızlık veya ilerleme yok. |
| 2 | Geçersiz kullanım ya da reddedilmiş/gerekli onay. |
| 3 | Eksik/geçersiz yapılandırma. |
| 4 | İş akışı engellendi, geçit geçmedi, kilit/yönetim çakışması veya girdi gerekli. |
| 5 | Sağlayıcı başarısızlığı. |
| 6 | Doğrulama/şema başarısızlığı. |
| 130 | Kesintiye uğradı. |

## Komut başvurusu

### `amiral plan`

```text
amiral plan [goal]
  --type <feature|bugfix|refactor>   default: feature
  --request <text>                   complete original request
  --name <name>                      prefix used in generated plan ID
  --plan-file <file-or-plan-id>      import and validate planner-format JSON
  --json
```

Planlama sağlayıcısını çalıştırır (içe aktarma dışında), grafiği doğrulayıp analiz eder, çıktı dosyalarını (artifact'ları) `plans/<plan-id>/` altına kaydeder, görev sayısı/derinlik/paralel gruplar/çakışma uyarılarını bildirir ve **uygulama yapmadan çıkar**.

```bash
amiral plan "Repair duplicate invoice creation" --type bugfix --name invoice-race
amiral plan --plan-file ./approved-plan.json --type refactor --json
```

İçe aktarılan `--plan-file` içeriği planlayıcı biçiminde JSON olmalıdır; `plan` yeni, normalleştirilmiş bir plan dizini yazar. Önceden kaydedilmiş bir grafiği doğrudan çalıştırmak için `run --plan` kullanın.

### `amiral run`

```text
amiral run [goal]
  --plan <id-or-file>
  --workflow <id>
  --type <feature|bugfix|refactor>   default: feature
  --request <text>
  --name <name>
  --plan-file <file-or-plan-id>
  --json
```

Tam olarak bir çalıştırma kipi seçilebilir:

1. `[goal]`, `--request` veya `--plan-file`: plan oluşturur, iş akışı oluşturur ve ardından çalıştırır.
2. `--plan <id-or-file>`: kaydedilmiş planlayıcı sonucunu/görev grafiğini doğrular, iş akışı oluşturur ve ardından çalıştırır.
3. `--workflow <id>`: belirtilen kalıcı iş akışını sürdürür.
4. Kip yok: etkin iş akışını (hiçbiri seçili değilse tek iş akışını) sürdürür.

`--name`, yeni üretilen plan/iş akışı kimliklerini adlandırır; mevcut iş akışını yeniden adlandırmaz. `--type`, yeni çevrimiçi planlamayı denetler ve içe aktarılan grafikte iş akışı türü yoksa yedek değerdir.

```bash
amiral run "Add favorites" --type feature
amiral run --plan feature-ab12cd34
amiral run --plan ./plans/reviewed/task-graph.json --name favorites-approved
amiral run --workflow feature-cd34ef56 --verbose
amiral run                              # etkin iş akışı
```

`run`, çalışma zamanı kilidini tutar ve zamanlama, sağlayıcıya gönderme, entegrasyon, inceleme/düzeltme turları ve QA boyunca yinelenir. Tamamlandığında veya güvenli bir duraklama koşulunda döner; daemon değildir.

### `amiral status`

```text
amiral status [--workflow <id>] [--json] [--verbose]
```

İş akışı durumunu, yapılandırılmış varsayılan sağlayıcı adını, görev sayılarını ve yeniden deneme/sağlayıcı hatası ayrıntılarını, kalite durumunu ve etkin worktree'leri gösterir. Canlı sağlayıcı sağlık veya kimlik doğrulama denetimi yapmaz; tanılama için `doctor` kullanın. `--workflow` olmadan etkin/tek iş akışını çözümler.

```bash
amiral status
amiral status --workflow feature-cd34ef56 --json
```

### `amiral workflow`

Yönetim ve inceleme alt komutları:

```text
amiral workflow list
amiral workflow use <id>
amiral workflow show <id> [--json]
amiral workflow cancel <id> [--force]
amiral workflow reset-task <task-id> [--workflow <id>] [--force]
amiral workflow history [id] [--limit <positive-integer>]   default: 20
```

- `list`: kimlikleri, durumları, etkin seçimi ve güncelleme zamanlarını listeler.
- `use`: kimliksiz komutların kullandığı etkin iş akışı seçimini yazar.
- `show`: varsa grafik hedefini/özetini ve görev ayrıntılarını gösterir.
- `cancel`: iş akışını iptal eder ve kiralamaları serbest bırakır. TTY'de sorar; etkileşimsiz kullanım `--force` gerektirir.
- `reset-task`: bir görevi elle yeniden denenebilir duruma döndürür. `--workflow` belirsizliği giderir; `--force`, aksi hâlde kısıtlı sıfırlama durumlarına izin verir. Bu alt komut soru sormaz.
- `history`: `--limit` değerine kadar istenen en yeni geçmiş görünümünü gösterir; etkin çözümlemeyi kullanmak için kimliği atlayın.

```bash
amiral workflow list
amiral workflow use feature-cd34ef56
amiral workflow show feature-cd34ef56 --json
amiral workflow history feature-cd34ef56 --limit 50
amiral workflow cancel obsolete-workflow --force
amiral workflow reset-task API-002 --workflow feature-cd34ef56 --force
```

### `amiral retry`

```text
amiral retry <task-id> [--workflow <id>] [--force]
amiral retry --failed [--workflow <id>]
amiral retry --blocked [--workflow <id>]
```

Tam olarak bir görev kimliği, `--failed` veya `--blocked` seçin. Eşleşen görevleri sıfırlar ancak worktree'lerini korur; görevleri çalıştırmaz. Sonrasında `amiral run --workflow <id>` (veya etkin iş akışı için `amiral run`) çalıştırın.

```bash
amiral retry API-002 --workflow feature-cd34ef56
amiral retry --failed --workflow feature-cd34ef56
amiral run --workflow feature-cd34ef56
```

### `amiral review` ve `amiral qa`

```text
amiral review [--workflow <id>] [--json]
amiral qa     [--workflow <id>] [--json]
```

Seçili iş akışı/entegrasyon çalışma alanına karşı bağımsız bir geçit çalıştırır. İnceleme; kararı, özeti ve bulguları, QA ise kararı, denetimleri ve bulguları bildirir. `PASS` dışındaki kararlar kod 4 ile çıkar. Bu komutlar yalnızca bir geçit çalıştırır; `run` komutunun tam yaşam döngüsünün yerine geçmez veya ortaya çıkan düzeltmeleri otomatik çalıştırmaz.

```bash
amiral review --workflow feature-cd34ef56
amiral qa --workflow feature-cd34ef56 --json
```

### `amiral clean`

```text
amiral clean [--workflow <id> | --all]
  [--completed] [--remove-failed] [--remove-blocked]
  [--delete-branches] [--dry-run] [--force]
```

Temizleme ihtiyatlıdır:

- Temizleme politikası seçicisi yoksa yalnızca tamamlanmış worktree temizliğini önizler; hiçbir dosya silinmez.
- `--dry-run` her zaman önizler.
- `--completed`, tamamlanmış worktree'lerin kaldırılmasını etkinleştirir.
- `--remove-failed` / `--remove-blocked`, saklanan başarısız/engellenmiş worktree'leri silmeyi açıkça seçer.
- `--delete-branches`, dal silmeyi açıkça seçer; aksi hâlde dallar korunur.
- Kapsam varsayılan olarak etkin iş akışıdır; `--workflow` veya `--all` seçeneklerinden birini seçin, ikisini birden asla seçmeyin.
- Gerçek temizleme TTY'de sorar ve etkileşimsiz ortamlarda `--force` gerektirir.
- Mevcut önizleme genel worktree kullanımını bildirir. Gösterilen kapsam bağlamsal üst veridir; `--workflow` ile filtrelenmiş, worktree başına kesin silme planı değildir.

```bash
amiral clean --workflow feature-cd34ef56 --dry-run
amiral clean --workflow feature-cd34ef56 --completed
amiral clean --all --completed --remove-failed --delete-branches --force
```

### `amiral doctor`

```text
amiral doctor [--json] [--fix]
```

Proje düzenini, Git/sağlayıcı/yapılandırma sağlığını, çalışma zamanı dizinlerini ve eski worktree'leri denetler. `--fix` sınırlı destek onarımı yapar: `.amiral/worktrees`, `.amiral/integration` ve `tasks` dizinlerini güvenceye alır, minimal başlatmayı çalıştırır ve işaretçiyle yönetilen `.gitignore` bloğunu güvenceye alır. Genel amaçlı otomatik onarım aracı değildir; Git'i başlatmaz veya sağlayıcı kimlik doğrulaması yapmaz.

```bash
amiral doctor --json
amiral doctor --fix
```

### `amiral config`

```text
amiral config path
amiral config show [--json]
amiral config validate [--json]
```

- `path`: bulunan mutlak `team.yaml` yolunu yazdırır.
- `show`: normalleştirilmiş yapılandırmayı, etkin çalıştırma/sağlayıcı kapasitesini ve kayıtlı sağlayıcıları yazdırır. token/key/secret/password ile eşleşen anahtarlar özyinelemeli olarak `[REDACTED]` ile değiştirilir.
- `validate`: varsayılan sağlayıcının kayıtlı/etkin olduğunu ve yapılandırmanın en az bir nesne değerli ajan tanımı içerdiğini doğrular; çıktı sağlayıcı/kapasite verilerini içerir. Her ajan alanını veya karşılık gelen ajan dosyasını derinlemesine doğrulamaz.

```bash
amiral config path
amiral config show --json
amiral config validate
```

Maskeleme bir görüntüleme güvencesidir; gizli bilgileri `team.yaml` içinde saklama izni değildir.

## Kalıcılık, durdurma ve sürdürme

Planlar ve iş akışları farklı kalıcı nesnelerdir:

```text
plans/<plan-id>/
├── planner-result.json
├── task-graph.json
├── planner-result.raw.txt
├── planner-result.raw.json
└── planner-diagnostics.json          # çevrimiçi planlama; başarısız girişimler de kaydedilebilir

tasks/
├── .active-workflow
└── <workflow-id>/
    ├── state.json
    ├── task-graph.json
    ├── history.json
    ├── requests/                     # dizin adı yapılandırılabilir
    └── results/

.amiral/
├── amiral.lock
├── amiral.lock.guard                 # geçici iç mutex; eski durum kurtarması bunu kaldırabilir
├── worktrees/<workflow-id>/...       # görev worktree'leri
└── integration/<workflow-id>/...     # entegre ağaç ve geçit çıktı dosyaları (artifact'ları)
```

Bu yollar yerel çalışma zamanı çıktı dosyalarıdır (artifact'lardır) ve başlatıcı bunları `.gitignore` dosyasına ekler. Belgelenmiş bir SQLite durum deposu yoktur: JSON dosyaları esas kayıt kaynağı, yani tek doğruluk kaynağıdır. Bir komut `.amiral/amiral.lock` kilidini tutarken durumu elle düzenlemeyin.

`--workflow` olmadan iş akışı çözümlemesi `tasks/.active-workflow` kullanır; bu yoksa tek iş akışı otomatik seçilir, birden çok iş akışı ise `amiral workflow use <id>` veya açık bir kimlik gerektirir.

`run` şu nedenlerle güvenli biçimde durur:

- `completed`: tüm uygulama/düzeltme işleri entegre edildi, inceleme ve QA geçti.
- `retry_scheduled`: geçici sağlayıcı yeniden denemesi bekliyor; biliniyorsa `nextRetryAt` ile birlikte çıkış kodu 0. Bu zamandan sonra yeniden çalıştırın.
- `failed`: yeniden denenemez/tükenmiş görev başarısızlığı; durumu/sonuçları inceleyin, `retry` ile sıfırlayın ve yeniden çalıştırın.
- `blocked`: iş akışı/görev engeli; durumu/geçmişi inceleyin ve uygun şekilde çözün veya elle sıfırlayın.
- `needs_input`: iptal edilmiş iş akışı, engellenmiş/başarısız geçit, inceleme düzeltmelerinin tükenmesi veya 25 yinelemelik güvenlik sınırı. Güvenlik sınırı mesajı başka bir çalıştırmaya açıkça izin verir.
- `max_review_rounds`: inceleme değişiklikleri yapılandırılmış tur sayısı içinde ilerleyemedi; iş akışı engellenir.
- `no_progress`: zamanlanabilir görev ve bekleyen yeniden deneme yok; bağımlılıkları ve geçmişi inceleyin.
- `interrupted`: ilk `SIGINT`/`SIGTERM`, sonraki mutasyondan önce güvenli duruş ister ve 130 ile çıkar. İkinci sinyal hemen sonlandırır; bu nedenle yalnızca gerektiğinde kullanın.

Sürdürme yeniden planlama yapmaz:

```bash
amiral status --workflow feature-cd34ef56
amiral workflow history feature-cd34ef56 --limit 50
amiral run --workflow feature-cd34ef56
```

Paylaşılan çalışma zamanı durumunu değiştiren komutlar proje kilidi kullanır. Başka bir işlem kilide sahipse o işlemi bekleyin veya gerçekten eski kalmış sahibi teşhis edin; etkin kilidi düşünmeden silmeyin.

## Sorun giderme

### “No Amiral project found”

Amaçlanan ağaçtan çalıştırın, bir üst dizinde `team.yaml` bulunduğunu doğrulayın veya projeyi başlatın. `amiral config path`, bulmayı doğrular.

### Sağlayıcı çalıştırılabilir dosyası/kimlik doğrulama başarısızlığı

`amiral doctor --verbose` ve `amiral config show` çalıştırın; `providers.<name>.binary`, `enabled`, PATH çözümlemesi ve Amiral dışındaki sağlayıcı oturumunu doğrulayın. Sağlayıcı hataları `team.yaml` uyarınca yeniden denenebilir; planlama başarısızlıklarının tanıları kalıcı olarak saklanır.

### Birden çok iş akışı var ve hiçbiri etkin değil

```bash
amiral workflow list
amiral workflow use <workflow-id>
```

Alternatif olarak `--workflow` seçeneğini açıkça geçirin.

### Kirli ağaç veya birleştirme çakışması

Yalnızca amaçladığınız kendi değişikliklerinizi commit/stash edin, ilgisiz işi koruyun, görev/entegrasyon worktree'lerini inceleyin ve altta yatan Git koşulunu çözdükten sonra yeniden deneyin. Yıkıcı sıfırlamaları rutin çözüm olarak kullanmayın.

### Bir çalıştırma başarıyla döndü ancak tamamlanmadı

JSON/metin `reason` değerini denetleyin. `retry_scheduled`, çalıştırma duraklamış olsa da bilerek 0 döndürür. `nextRetryAt` zamanına kadar bekleyip sürdürün. Yalnızca `reason: "completed"` tüm geçitlerin geçtiği anlamına gelir.

### Bir görev başarısız oldu veya engellendi

```bash
amiral status --workflow <id> --json
amiral workflow history <id> --limit 100
amiral workflow show <id> --json
amiral retry <task-id> --workflow <id>
amiral run --workflow <id>
```

`--force` seçeneğini yalnızca sıfırlama/iptal/temizlemenin neden kısıtlandığını anladıktan sonra kullanın.

### JSON ayrıştırma başarısız

Komuta `--json` ekleyin, yalnızca stdout'u ayrıştırın ve stderr'i ayrı tutun. JSON tüketirken akışları (`2>&1`) birleştirmeyin. Onay isteyen istemler CI'da `--force` gerektirir.

## Mimari ve depo düzeni

```text
AGENTS.md                     ekip genelindeki çalışma kuralları
team.yaml                     ajanlar, sağlayıcılar, kapasiteler, iş akışları
.opencode/
├── agents/                   rol talimatları
├── workflows/                feature, bugfix, refactor süreçleri
├── orchestration/            çalıştırma/bağımlılık/hata protokolleri
├── contracts/                görev, ajan sonucu, inceleme sözleşmeleri
├── policies/                 mimari, Git, inceleme, test kuralları
├── prompts/ and schemas/     makine istemleri ve doğrulama sözleşmeleri
└── opencode.json             OpenCode yapılandırması
src/cli/                      ürün CLI tanımları
scripts/lib/                  orkestrasyon çalışma zamanı
templates/init/               `amiral init` tarafından kurulan dosyalar
tests/                        Node test paketi
memory/                       mimari, kurallar, kararlar, dersler
```

Etkin paketlenmiş iş akışları `feature`, `bugfix` ve `refactor`dır. Ajanlar Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer ve QA'i içerir. Ajan tanımları sorumluluğu; iş akışları süreci açıklar; politikalar çapraz kesen kuralları uygular; sözleşmeler makinece okunabilir devirleri tanımlar; beceriler yalnızca ilgili olduğunda uzmanlık bilgisi sağlar.

## Kaynak kod geliştirme

Bu depoyu klonlayın ve kilitlenmiş bağımlılıkları kurun:

```bash
git clone https://github.com/atahandevelopment/opencode-ai-team.git
cd opencode-ai-team
npm ci
npm run typecheck
npm test
npm run build
node dist/src/cli/index.js --help
```

Yararlı betikler:

| Betik | Amaç |
| --- | --- |
| `npm run typecheck` | Dağıtılabilir derlemeyi üretmeden tür denetimi yapar. |
| `npm test` | Node test paketini `tsx` üzerinden çalıştırır. |
| `npm run build` | `tsconfig.build.json` ile `dist/` içine derler. |
| `npm run validate:team -- <task-graph|agent-result|review-result|planner-result> <file>` | Bir JSON sözleşme yapısını seçili şemaya göre doğrular. |
| `npm pack --dry-run` | Yayım içeriğini inceler; `prepack`, `dist` dizinini temizleyip yeniden derler. |

Kaynak ağaç CLI testi için önce derleyin ve `node dist/src/cli/index.js ...` çağırın; yayımlanan `amiral` ikili dosyası bu derlenmiş giriş noktasını gösterir. Eski `scripts/*.ts` giriş noktaları uyumluluk/dahili araçlar olarak kalır ancak ürün kullanımı CLI'ı tercih etmelidir.

## Lisans

Bu paket `package.json` içinde ISC lisansını bildirir.
