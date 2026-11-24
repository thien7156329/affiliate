import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { VideoItem } from '../../types';
import { formatYoutubePlaylistName, inferDefaultYoutubePlaylist } from '../modals/YouTubePublishModal';

interface VoiceProfile {
  id: string;
  label: string;
  gender: 'female' | 'male';
  accent: string;
  trained?: boolean;
}

interface ShortsJob {
  jobId: string;
  videoId: string;
  topic: string;
  style: string;
  aspectRatio?: '9:16' | '16:9';
  status: 'running' | 'review' | 'done' | 'error';
  step: string;
  progress: number;
  logs: string[];
  error?: string;
  startedAt?: number;
  reviewMode?: 'chapter' | 'all';
  reviewIndex?: number;
  chapters?: { n: number; from: number; to: number; url: string | null }[];
}

interface ShortsVideoEntry {
  id: string;
  flow: string;
  style?: string;
  aspectRatio?: '9:16' | '16:9';
  state: 'ready' | 'attention' | 'progress';
  progress: { done: number; total: number; nextStep: string | null };
  updatedAt: number;
  files: {
    uploadMp4: string | null;
    draftMp4: string | null;
    coverJpg: string | null;
    voiceWav: string | null;
  };
  title: string;
  caption: string;
  description: string;
  pinnedComment: string;
  tags: string[];
  narrationSummary: string;
  dbVideo: VideoItem | null;
  s3Synced: boolean;
}

interface ShortsStudioSectionProps {
  studioFormat?: 'short' | 'long';
  onVideoSynced: () => void;
  onOpenPublishModal: (video: VideoItem) => void;
}

const TOPIC_CATEGORIES = [
  { key: 'hot', label: '🔥 Đang Hot' },
  { key: 'money', label: '💰 Tiền bạc & Kinh doanh' },
  { key: 'decode', label: '🧠 Giải mã & Văn hóa' },
  { key: 'law', label: '⚖️ Luật & Quyền lợi' },
  { key: 'health', label: '🏥 Sức khỏe & Tâm lý' },
  { key: 'spirit', label: '🕯️ Tâm linh – Truyện ma có thật' },
] as const;

type TopicCategoryKey = (typeof TOPIC_CATEGORIES)[number]['key'];

const SUGGESTED_TOPICS: {
  cat: TopicCategoryKey;
  label: string;
  id: string;
  prompt: string;
}[] = [
  // 🔥 Đang Hot
  {
    cat: 'hot',
    label: '☕ Vì sao quán cà phê đẹp đông khách vẫn sập sau 6 tháng?',
    id: 'vi-sao-quan-ca-phe-dep-van-sap',
    prompt: 'Giải mã nghịch lý vì sao rất nhiều quán cà phê đầu tư decor tiền tỷ, khách check-in chật kín nhưng chỉ sau 6 tháng đã phải sang nhượng cắt lỗ: bẫy chi phí mặt bằng, khách ngồi 4 tiếng gọi 1 ly 35k và khấu hao nội thất.',
  },
  {
    cat: 'hot',
    label: '🛒 Bí mật cách siêu thị sắp xếp kệ hàng khiến bạn tiêu gấp đôi',
    id: 'bi-mat-sieu-thi-sap-xep-ke-hang',
    prompt: 'Vì sao siêu thị luôn giấu sữa tươi, trứng và thịt ở góc trong cùng, đặt bánh kẹo ngang tầm mắt trẻ em ở quầy thu ngân và không bao giờ treo đồng hồ hay làm cửa sổ? Giải mã tâm lý học bán lẻ khiến bạn mua gấp đôi dự định.',
  },
  {
    cat: 'hot',
    label: '⌨️ Vì sao bàn phím xếp chữ QWERTY lộn xộn thay vì ABC?',
    id: 'vi-sao-ban-phim-xep-chu-qwerty',
    prompt: 'Sự thật bất ngờ đằng sau việc bàn phím máy tính và điện thoại lại xếp thứ tự QWERTY rối mắt thay vì bảng chữ cái ABC: bắt nguồn từ mục đích cố tình làm người gõ chậm lại thời máy chữ cơ học và hiệu ứng khóa chặt thói quen.',
  },
  {
    cat: 'hot',
    label: '💸 Chuyển khoản hộ bạn bè có bị tính thuế thu nhập không?',
    id: 'chuyen-khoan-ho-co-bi-tinh-thue',
    prompt: 'Nhận tiền chuyển khoản giùm bạn bè, gom tiền quỹ nhóm hoặc đứng tên tài khoản nhận hộ doanh thu có nguy cơ bị cơ quan thuế truy thu hay liên đới pháp lý thế nào? Cách ghi nội dung chuyển khoản an toàn ai cũng cần biết.',
  },
  {
    cat: 'hot',
    label: '😴 Vì sao ngủ trưa quá 45 phút dậy lại đau đầu mệt rã rời?',
    id: 'ngu-trua-qua-45-phut-dau-dau',
    prompt: 'Giải mã hiện tượng quán tính giấc ngủ (Sleep Inertia): vì sao chợp mắt 20 phút buổi trưa thì tỉnh táo sảng khoái, nhưng ngủ lố sang 60–90 phút khi thức dậy lại choáng váng, tim đập nhanh và mệt hơn cả lúc chưa ngủ?',
  },
  {
    cat: 'hot',
    label: '🥇 Vì sao tiệm vàng chỉ ghi 9999 chứ không bao giờ ghi 100%?',
    id: 'vi-sao-vang-9999-khong-ghi-100',
    prompt: 'Tại sao vàng ta nguyên chất nhất ngoài tiệm chỉ gọi là vàng bốn số 9 (99,99%) mà không bao giờ gọi là vàng 100%, và vì sao nhẫn cưới lại phải pha thành vàng 18K thay vì dùng vàng 9999?',
  },
  {
    cat: 'hot',
    label: '📦 Bẫy nhượng quyền trà sữa 0 đồng: Ai mới là người kiếm lời?',
    id: 'bay-nhuong-quyen-tra-sua-gia-re',
    prompt: 'Bóc tách mô hình nhượng quyền trà sữa, ănặt vặt vốn thấp thu hồi vốn nhanh: vì sao chủ thương hiệu không lãi từ phí nhượng quyền ban đầu mà kiếm bộn tiền từ việc ép mua nguyên liệu độc quyền giá cao?',
  },
  {
    cat: 'hot',
    label: '🧠 Hiệu ứng Diderot: Mua 1 món sale kéo theo tốn chục triệu',
    id: 'hieu-ung-diderot-mua-1-ton-10',
    prompt: 'Giải mã Hiệu ứng Diderot trong tâm lý học tiêu dùng: vì sao chỉ từ việc mua một đôi giày giảm giá hoặc một chiếc ốp lưng mới lại kích hoạt chuỗi mua sắm dây chuyền khiến bạn vung sạch tháng lương?',
  },

  // 💰 Tiền bạc & Kinh doanh
  {
    cat: 'money',
    label: '🏠 Lương 15-20tr: Vay mua chung cư trả góp hay Thuê nhà?',
    id: 'mua-nha-tra-gop-hay-thue-nha',
    prompt: 'Lương 15 đến 20 triệu một tháng ở thành phố lớn thì nên cố vay ngân hàng mua chung cư trả góp hay đi thuê nhà rồi lấy tiền dư đầu tư? Bài toán lãi suất thả nổi sau ưu đãi mà ít người tính kỹ.',
  },
  {
    cat: 'money',
    label: '💳 Bẫy trả góp 0% và trả tối thiểu 5% sao kê thẻ tín dụng',
    id: 'bay-tra-gop-0-phan-tram-the-tin-dung',
    prompt: 'Sự thật đằng sau các chương trình mua hàng trả góp lãi suất 0 phần trăm và việc chỉ thanh toán số tiền tối thiểu 5 phần trăm trên sao kê thẻ tín dụng mỗi tháng khiến lãi mẹ đẻ lãi con lên tới 30–40%/năm.',
  },
  {
    cat: 'money',
    label: '🚗 Nuôi ô tô 500 triệu ở phố tốn bao nhiêu tiền thật mỗi tháng?',
    id: 'chi-phi-that-nuoi-o-to-500-trieu',
    prompt: 'Mua chiếc ô tô 500 triệu tưởng nhẹ nhàng nhưng tổng chi phí gửi bãi, xăng xe, bảo hiểm, đăng kiểm, phí cầu đường và khấu hao mất giá mỗi tháng thực tế ngốn bao nhiêu phần trăm thu nhập gia đình trẻ?',
  },
  {
    cat: 'money',
    label: '📉 Vì sao tiệm vàng luôn nới rộng chênh lệch mua vào – bán ra khi sốt giá?',
    id: 'chenh-lech-mua-ban-vang-khi-sot-gia',
    prompt: 'Tại sao mỗi khi giá vàng biến động mạnh, các tiệm vàng lập tức kéo giãn khoảng cách giá mua vào và bán ra lên tới vài triệu đồng mỗi lượng? Ai là người chịu toàn bộ rủi ro khi đu đỉnh lướt sóng vàng?',
  },
  {
    cat: 'money',
    label: '🏷️ Mánh khóe "Neo giá chim mồi" ly size M và size L ở rạp phim',
    id: 'manh-khoe-neo-gia-chim-moi',
    prompt: 'Vì sao bắp nước ở rạp chiếu phim hay chuỗi cà phê luôn có cỡ vừa đắt gần bằng cỡ lớn (ví dụ nhỏ 45k, vừa 65k, lớn 70k)? Giải mã hiệu ứng Chim mồi (Decoy Effect) thao túng não bộ người mua.',
  },
  {
    cat: 'money',
    label: '🏦 Gửi tiết kiệm kỳ hạn nào lợi nhất mà vẫn rút linh hoạt?',
    id: 'meo-chia-so-tiet-kiem-loi-lai-suat',
    prompt: 'Sai lầm gom hết tiền nhàn rỗi vào 1 sổ tiết kiệm 12 tháng rồi đến tháng thứ 10 cần tiền gấp phải rút trước hạn mất trắng lãi suất về 0,1%. Cách chia thang kỳ hạn thông minh của dân tài chính.',
  },

  // 🧠 Giải mã & Văn hóa
  {
    cat: 'decode',
    label: '🛂 Vì sao hộ chiếu toàn thế giới chỉ có đúng 4 màu Đỏ, Xanh, Lá, Đen?',
    id: 'vi-sao-ho-chieu-chi-co-4-mau',
    prompt: 'Có gần 200 quốc gia nhưng vì sao cuốn hộ chiếu trên toàn thế giới chỉ xoay quanh đúng 4 tông màu Đỏ, Xanh dương, Xanh lá và Đen? Ý nghĩa địa chính trị, tôn giáo và lịch sử ẩn sau màu bìa hộ chiếu Việt Nam.',
  },
  {
    cat: 'decode',
    label: '⚔️ 3 hiểu lầm kinh điển về Tam Quốc do phim ảnh thêu dệt',
    id: 'hieu-lam-kinh-dien-ve-tam-quoc',
    prompt: 'Sự thật lịch sử Tam Quốc Chí khác xa tiểu thuyết Tam Quốc Diễn Nghĩa: Chu Du không hề nhỏ nhen tức chết vì Gia Cát Lượng, Trương Phi thực chất viết chữ đẹp biết vẽ tranh và Thuyền cỏ mượn tên thuộc về Tôn Quyền.',
  },
  {
    cat: 'decode',
    label: '✈️ Vì sao cửa sổ máy bay luôn phải bo tròn và có 1 lỗ thủng nhỏ?',
    id: 'vi-sao-cua-so-may-bay-bo-tron',
    prompt: 'Tại sao cửa sổ máy bay thương mại tuyệt đối không làm hình vuông sắc cạnh và luôn có một lỗ nhỏ li ti ở lớp kính giữa? Thảm họa hàng không thập niên 1950 đã thay đổi thiết kế máy bay mãi mãi.',
  },
  {
    cat: 'decode',
    label: '🍜 Nguồn gốc thật sự của chữ "Phở" Việt Nam từ đâu mà ra?',
    id: 'nguon-goc-that-su-cua-chu-pho',
    prompt: 'Giải mã tranh cãi hơn 100 năm về nguồn gốc món Phở Việt Nam: bắt nguồn từ món xáo trâu gánh rong bến sông Hồng, biến âm từ "Pot-au-feu" của Pháp hay "Ngưu nhục phấn" của người Quảng Đông?',
  },
  {
    cat: 'decode',
    label: '🗓️ Vì sao tháng 2 chỉ có 28 ngày còn tháng 7 và 8 đều 31 ngày?',
    id: 'vi-sao-thang-2-chi-co-28-ngay',
    prompt: 'Tại sao lịch dương lại chia ngày kỳ lạ khiến tháng 2 bị cắt cụt còn 28 ngày trong khi tháng 7 và tháng 8 đứng cạnh nhau đều có 31 ngày? Câu chuyện tự ái quyền lực của hai Hoàng đế La Mã Julius Caesar và Augustus.',
  },
  {
    cat: 'decode',
    label: '💎 Kim cương thật sự quý hiếm hay là cú lừa marketing thế kỷ?',
    id: 'kim-cuong-quy-hiem-hay-marketing',
    prompt: 'Vì sao kim cương mua khỏi tiệm bước ra cửa đã mất giá gần một nửa và con người hiện đại mới coi nhẫn kim cương là biểu tượng đính hôn? Giải mã chiến dịch kiểm soát nguồn cung lịch sử của tập đoàn De Beers.',
  },

  // ⚖️ Luật & Quyền lợi
  {
    cat: 'law',
    label: '💰 Rút BHXH 1 lần hay chờ lương hưu theo luật mới?',
    id: 'rut-bhxh-1-lan-hay-luong-huu',
    prompt: 'Nên rút bảo hiểm xã hội một lần hay đóng tiếp để chờ lương hưu theo luật mới? Phân tích con số thực tế sau 15 năm đóng BHXH và sai lầm khiến nhiều người lao động tiếc nuối.',
  },
  {
    cat: 'law',
    label: '💬 Cho vay tiền chỉ có tin nhắn Zalo có khởi kiện đòi được không?',
    id: 'cho-vay-tien-qua-zalo-co-doi-duoc-khong',
    prompt: 'Cho bạn bè, người quen mượn tiền không viết giấy tay mà chỉ có lịch sử chuyển khoản ngân hàng và tin nhắn Zalo, Messenger thì khi họ chây ì quỵt nợ có lập vi bằng khởi kiện ra tòa đòi lại được không?',
  },
  {
    cat: 'law',
    label: '🏍️ Bán xe máy cũ không thu hồi biển số: Chủ cũ lãnh đủ phạt nguội!',
    id: 'ban-xe-cu-khong-thu-hoi-bien-so',
    prompt: 'Quy định biển số định danh mới: vì sao bán xe máy, ô tô cũ chỉ viết giấy tay mà không làm thủ tục thu hồi biển số thì khi chủ mới vượt đèn đỏ hay gây tai nạn, chủ cũ vẫn bị gọi tên chịu trách nhiệm?',
  },
  {
    cat: 'law',
    label: '🚨 Chiêu lừa đảo AI ghép mặt & giả danh Công an, Thuế vụ',
    id: 'chieu-lua-dao-ai-ghep-mat',
    prompt: 'Giải mã chiêu trò lừa đảo cuộc gọi video AI Deepfake ghép mặt người thân và giả danh công an, thuế vụ gửi link cài ứng dụng chiếm quyền điều khiển điện thoại rút sạch tiền ngân hàng trong 30 giây.',
  },
  {
    cat: 'law',
    label: '🏢 Nghỉ việc chưa hết phép năm có được công ty trả lại bằng tiền?',
    id: 'nghi-viec-con-phep-nam-co-duoc-thanh-toan',
    prompt: 'Khi chấm dứt hợp đồng lao động mà vẫn còn dư ngày nghỉ phép năm chưa dùng hết, người lao động có quyền yêu cầu công ty thanh toán thành tiền mặt theo Bộ luật Lao động hay không và trường hợp nào bị mất trắng?',
  },

  // 🏥 Sức khỏe & Tâm lý
  {
    cat: 'health',
    label: '☕ Vì sao có người uống cà phê xong không tỉnh mà lại buồn ngủ rũ rượi?',
    id: 'uong-ca-phe-xong-lai-buon-ngu',
    prompt: 'Giải thích cơ chế khoa học vì sao nhiều người vừa uống ly cà phê sữa xong lại ngáp ngắn ngáp dài buồn ngủ hơn: cuộc đua giữa phân tử Caffeine và chất gây buồn ngủ Adenosine kết hợp cú tụt đường huyết từ sữa đặc.',
  },
  {
    cat: 'health',
    label: '👂 Ngoáy tai bằng tăm bông mỗi ngày: Sạch đâu chẳng thấy chỉ hại tai',
    id: 'ngoay-tai-bang-tam-bong-hai-tai',
    prompt: 'Vì sao các bác sĩ tai mũi họng luôn khuyên tuyệt đối không dùng tăm bông chọc sâu vào ống tai sau khi tắm? Cơ chế tự làm sạch kỳ diệu của ráy tai và nguy cơ nén chặt nút ráy gây ù tai, viêm ống tai ngoài.',
  },
  {
    cat: 'health',
    label: '🌙 Thức quá 12h đêm bấm điện thoại tàn phá não và gan thế nào?',
    id: 'tac-hai-thuc-khuya-bam-dien-thoai',
    prompt: 'Điều gì xảy ra bên trong não bộ, gan và mạch máu khi bạn thức quá 12 giờ đêm để lướt điện thoại trong bóng tối? Vì sao ngủ bù tới trưa hôm sau vẫn không thể dọn sạch độc tố thần kinh tích tụ?',
  },
  {
    cat: 'health',
    label: '🥤 Nước ngọt không đường Zero Calo có thật sự vô hại?',
    id: 'nuoc-ngot-khong-duong-zero-calo',
    prompt: 'Uống nước ngọt không đường Zero Calo mỗi ngày có giúp giảm cân như quảng cáo hay chất tạo ngọt nhân tạo vẫn đánh lừa vị giác, làm rối loạn hệ vi sinh đường ruột và khiến bạn thèm ăn đồ ngọt gấp đôi?',
  },
  {
    cat: 'health',
    label: '📱 Vì sao nằm lướt điện thoại cả ngày không làm gì vẫn mệt rã rời?',
    id: 'nam-luot-dien-thoai-ca-ngay-van-met',
    prompt: 'Nghịch lý ngày nghỉ nằm dài trên giường lướt video ngắn suốt nhiều tiếng nhưng chiều tối dậy lại thấy kiệt sức, uể oải hơn cả ngày đi làm: hiện tượng quá tải Dopamine rẻ tiền và mỏi mệt nhận thức của não bộ.',
  },
];

const FALLBACK_VOICES: VoiceProfile[] = [
  { id: 'MaiBePhuong', label: '🔥 [Giọng đã Train] Mai Bé Phương — Nữ Chính miền Nam (Trẻ trung, Cuốn hút)', gender: 'female', accent: 'Miền Nam', trained: true },
  { id: 'NamHoang', label: '🔥 [Giọng đã Train] Nam Hoàng — Nam Chính miền Nam (Trầm ấm, Tự nhiên)', gender: 'male', accent: 'Miền Nam', trained: true },
  { id: 'LanAnh', label: '🔥 [Giọng đã Train] Lan Anh — Nữ Reviewer (Sang trọng, Rõ nét)', gender: 'female', accent: 'Chuẩn Studio', trained: true },
  { id: 'NgocHuyen', label: 'Ngọc Huyền — Nữ Hà Nội (Truyền cảm, Kể chuyện)', gender: 'female', accent: 'Miền Bắc' },
  { id: 'Tuyen', label: 'Tuyên — Nam miền Bắc (Thuyết minh, Kịch tính)', gender: 'male', accent: 'Miền Bắc' },
  { id: 'Vinh', label: 'Vĩnh — Nam miền Nam (Ấm áp, Đời thường)', gender: 'male', accent: 'Miền Nam' },
  { id: 'Binh', label: 'Bình — Nam miền Bắc (Điềm tĩnh, Phân tích)', gender: 'male', accent: 'Miền Bắc' },
  { id: 'Doan', label: 'Đoàn — Nữ miền Nam (Dịu dàng, Gần gũi)', gender: 'female', accent: 'Miền Nam' },
  { id: 'Hanh', label: 'Hạnh — Nữ Hà Nội (Trong trẻo, Tin tức)', gender: 'female', accent: 'Miền Bắc' },
  { id: 'Huong', label: 'Hương — Nữ Hà Nội (Nhẹ nhàng, Podcast)', gender: 'female', accent: 'Miền Bắc' },
  { id: 'Thao', label: 'Thảo — Nữ Hà Nội (Năng động, Review)', gender: 'female', accent: 'Miền Bắc' },
  { id: 'Thi', label: 'Thi — Nữ miền Nam (Tự nhiên, Giải trí)', gender: 'female', accent: 'Miền Nam' },
  { id: 'Trang', label: 'Trang — Nữ Hà Nội (Sắc sảo, Tài chính)', gender: 'female', accent: 'Miền Bắc' },
  { id: 'Tuan', label: 'Tuấn — Nam miền Trung (Chắc chắn, Phóng sự)', gender: 'male', accent: 'Miền Trung' },
];

export const ShortsStudioSection: React.FC<ShortsStudioSectionProps> = ({
  studioFormat = 'short',
  onVideoSynced,
  onOpenPublishModal,
}) => {
  const { showToast } = useToast();
  const { confirmDialog } = useConfirm();
  const isLongStudio = studioFormat === 'long';
  const targetAspectRatio: '9:16' | '16:9' = isLongStudio ? '16:9' : '9:16';

  // Studio Form State
  const [style, setStyle] = useState('spirit');
  const [mode, setMode] = useState('content');
  const [duration, setDuration] = useState('auto');
  // "chapter": pause after every ~2 min chapter for review; "all": create straight through
  const [reviewMode, setReviewMode] = useState<'chapter' | 'all'>(() => {
    try {
      return (localStorage.getItem('shortsStudio.reviewMode') as 'chapter' | 'all') || 'chapter';
    } catch {
      return 'chapter';
    }
  });
  const changeReviewMode = (m: 'chapter' | 'all') => {
    setReviewMode(m);
    try {
      localStorage.setItem('shortsStudio.reviewMode', m);
    } catch {
      /* private mode */
    }
  };
  // AI model for script + visual direction; remembered per browser.
  const [aiModel, setAiModelState] = useState<string>(() => {
    try {
      return localStorage.getItem('shortsStudio.aiModel') || 'claude-sonnet-5-5-medium';
    } catch {
      return 'claude-sonnet-5-5-medium';
    }
  });
  const setAiModel = (m: string) => {
    setAiModelState(m);
    try {
      localStorage.setItem('shortsStudio.aiModel', m);
    } catch {
      /* private mode */
    }
  };
  const [customId, setCustomId] = useState('');
  const [voice, setVoice] = useState('vieneu:Anh Minh B');
  const [sampleText, setSampleText] = useState('Xin chào các bạn! Hôm nay chúng ta cùng khám phá một sự thật cực kỳ thú vị nhé.');
  const playlistTag = isLongStudio ? '[Video Dài]' : '[Shorts]';
  const defaultStudioPlaylist = `🍿 ${playlistTag} Hóng Hớt & Giải Mã Sự Thật`;

  const [topic, setTopic] = useState('');
  const [topicCat, setTopicCat] = useState<TopicCategoryKey>('hot');
  const [playlistName, setPlaylistName] = useState(defaultStudioPlaylist);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const STUDIO_PLAYLIST_PRESETS: Array<{ label: string; value: string; cat?: TopicCategoryKey }> = [
    { label: `🍿 ${playlistTag} Hóng Hớt & Giải Mã`, value: `🍿 ${playlistTag} Hóng Hớt & Giải Mã Sự Thật`, cat: 'hot' },
    { label: `💰 ${playlistTag} Tiền Bạc & Kinh Doanh`, value: `💰 ${playlistTag} Tiền Bạc & Kinh Doanh Thực Chiến`, cat: 'money' },
    { label: `⚖️ ${playlistTag} Luật & Quyền Lợi`, value: `⚖️ ${playlistTag} Luật Pháp & Quyền Lợi Sát Sườn`, cat: 'law' },
    { label: `🧠 ${playlistTag} Tâm Lý & Sức Khỏe`, value: `🧠 ${playlistTag} Tâm Lý Học & Sức Khỏe Đời Sống`, cat: 'health' },
  ];

  const CATEGORY_TO_PLAYLIST: Record<TopicCategoryKey, string> = {
    hot: `🍿 ${playlistTag} Hóng Hớt & Giải Mã Sự Thật`,
    decode: `🍿 ${playlistTag} Hóng Hớt & Giải Mã Sự Thật`,
    money: `💰 ${playlistTag} Tiền Bạc & Kinh Doanh Thực Chiến`,
    law: `⚖️ ${playlistTag} Luật Pháp & Quyền Lợi Sát Sườn`,
    health: `🧠 ${playlistTag} Tâm Lý Học & Sức Khỏe Đời Sống`,
    spirit: `🕯️ ${playlistTag} Giải Mã Tâm Linh`,
  };

  useEffect(() => {
    setPlaylistName((prev) =>
      formatYoutubePlaylistName(prev, isLongStudio ? 'long' : 'short')
    );
  }, [isLongStudio]);
  const [isSamplingVoice, setIsSamplingVoice] = useState(false);
  const [sampleAudioUrl, setSampleAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isFetchingRandomTopic, setIsFetchingRandomTopic] = useState(false);
  const [liveFeedFailed, setLiveFeedFailed] = useState(false);
  const [liveTrendingTopics, setLiveTrendingTopics] = useState<
    Array<{
      cat: TopicCategoryKey;
      label: string;
      id: string;
      prompt: string;
      sourceName?: string;
      sourceTitle?: string;
      sourceUrl?: string;
    }>
  >([]);
  const rolledTopicIdsRef = useRef<Set<string>>(new Set());
  const rolledTopicLabelsRef = useRef<Set<string>>(new Set());
  const hasAutoClonedFeedRef = useRef(false);

  // Studio Data State
  const [voices, setVoices] = useState<VoiceProfile[]>(FALLBACK_VOICES);
  const [videos, setVideos] = useState<ShortsVideoEntry[]>([]);
  const [jobs, setJobs] = useState<ShortsJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'progress' | 'attention' | 'ready' | 'unpublished' | 'published'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [styleFilter, setStyleFilter] = useState('all');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [togglingPublishId, setTogglingPublishId] = useState<string | null>(null);

  const getVideoPublishFlags = (dbv?: VideoItem | null) => {
    const hasYt = Boolean(dbv?.youtube_video_id || dbv?.youtube_url);
    const hasFb = Boolean(dbv?.fb_video_id || dbv?.fb_post_url || dbv?.fb_reel_url);
    const hasTt = Boolean(dbv?.tiktok_video_id || dbv?.tiktok_status === 'published');
    const anyPlatform = hasYt || hasFb || hasTt;
    const isPublished =
      dbv?.is_published !== undefined
        ? Boolean(dbv.is_published)
        : anyPlatform || dbv?.status === 'published';
    const ytUrl =
      dbv?.youtube_url ||
      dbv?.youtube_shorts_url ||
      (dbv?.youtube_video_id ? `https://www.youtube.com/watch?v=${dbv.youtube_video_id}` : '');
    const fbUrl =
      dbv?.fb_post_url ||
      dbv?.fb_reel_url ||
      (dbv?.fb_video_id && dbv?.fb_page_id
        ? `https://www.facebook.com/${dbv.fb_page_id}/videos/${dbv.fb_video_id}`
        : '');
    return { isPublished, hasYt, hasFb, hasTt, anyPlatform, ytUrl, fbUrl };
  };

  // Detail / Edit Modal State
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editVoice, setEditVoice] = useState('MaiBePhuong');
  const [editSentences, setEditSentences] = useState<{ id: string; text: string }[]>([]);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const prevJobStatusRef = useRef<Record<string, string>>({});

  const loadOverview = async () => {
    try {
      const res = await fetch(`/api/shorts-studio/overview?format=${encodeURIComponent(studioFormat)}`);
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.voices) && data.voices.length > 0) {
          setVoices(data.voices);
        }
        if (Array.isArray(data.videos)) {
          setVideos(data.videos);
        }
        if (Array.isArray(data.jobs)) {
          setJobs(data.jobs);
          // Detect newly completed job -> trigger S3/DB sync & refresh main gallery
          for (const j of data.jobs as ShortsJob[]) {
            const prevStatus = prevJobStatusRef.current[j.jobId];
            if (prevStatus === 'running' && j.status === 'review') {
              showToast(`📺 Chương ${j.reviewIndex ?? ''} của "${j.videoId}" đã sẵn sàng — xem rồi bấm Tiếp tục`);
            } else if ((prevStatus === 'running' || prevStatus === 'review') && j.status === 'done') {
              showToast(`🎉 Đã render xong "${j.videoId}" và tự động đồng bộ lên S3 + DB!`);
              onVideoSynced();
            } else if ((prevStatus === 'running' || prevStatus === 'review') && j.status === 'error') {
              showToast(`❌ Lỗi render "${j.videoId}": ${j.error || 'Xem chi tiết log'}`);
            }
            prevJobStatusRef.current[j.jobId] = j.status;
          }
        }
      }
    } catch (err) {
      // silent background poll error
    }
  };

  const fetchLiveNewsfeedTopics = async (opts: {
    category?: TopicCategoryKey;
    allCategories?: boolean;
    autoPick?: boolean;
    replaceCategory?: boolean;
    silent?: boolean;
  }) => {
    if (isFetchingRandomTopic) return;
    setIsFetchingRandomTopic(true);
    try {
      const excludeIds = Array.from(
        new Set(
          [
            ...videos.map((v) => v.id),
            ...SUGGESTED_TOPICS.map((t) => t.id),
            ...liveTrendingTopics.map((t) => t.id),
            ...Array.from(rolledTopicIdsRef.current),
            customId,
          ].filter(Boolean),
        ),
      );
      const excludeLabels = Array.from(
        new Set(
          [
            ...videos.map((v) => v.title),
            ...SUGGESTED_TOPICS.map((t) => t.label),
            ...liveTrendingTopics.map((t) => t.label),
            ...Array.from(rolledTopicLabelsRef.current),
          ].filter(Boolean),
        ),
      );

      const res = await fetch('/api/shorts-studio/random-trending-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: opts.category || topicCat,
          allCategories: Boolean(opts.allCategories),
          excludeIds,
          excludeLabels,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.topic) {
        throw new Error(data?.error || 'Không thể lấy chủ đề mới từ Newfeed');
      }

      const picked = data.topic as {
        cat: TopicCategoryKey;
        id: string;
        label: string;
        prompt: string;
        sourceName?: string;
        sourceTitle?: string;
        sourceUrl?: string;
      };
      const newSuggestions = (Array.isArray(data.suggestions) ? data.suggestions : [picked]) as Array<typeof picked>;
      for (const s of newSuggestions) {
        if (s?.id) rolledTopicIdsRef.current.add(s.id);
        if (s?.label) rolledTopicLabelsRef.current.add(s.label);
      }

      setLiveFeedFailed(false);
      setLiveTrendingTopics((prev) => {
        const targetCat = opts.category || topicCat;
        const basePrev = opts.replaceCategory ? prev.filter((p) => p.cat !== targetCat) : prev;
        const map = new Map<string, typeof picked>();
        for (const item of [...newSuggestions, ...basePrev]) {
          if (item?.id && !map.has(item.id)) {
            map.set(item.id, item);
          }
        }
        return Array.from(map.values()).slice(0, 36);
      });

      if (opts.autoPick) {
        const chosenCat = picked.cat || opts.category || topicCat;
        setTopicCat(chosenCat);
        setPlaylistName(CATEGORY_TO_PLAYLIST[chosenCat] || defaultStudioPlaylist);
        setTopic(picked.prompt);
        setCustomId(picked.id);
        showToast(
          `🔥 Đã săn chủ đề mới từ ${picked.sourceName || 'Báo chí hôm nay'}: "${picked.label}"`,
        );
      } else if (!opts.silent) {
        showToast(`📡 Đã cập nhật ${newSuggestions.length} chủ đề mới từ VnExpress, Tuổi Trẻ, Dân Trí!`);
      }
    } catch (err: any) {
      setLiveFeedFailed(true);
      if (!opts.silent) {
        showToast(`❌ Lỗi quét Newfeed: ${err.message || 'Thử lại sau'}`);
      }
    } finally {
      setIsFetchingRandomTopic(false);
    }
  };

  useEffect(() => {
    loadOverview();
    if (!hasAutoClonedFeedRef.current) {
      hasAutoClonedFeedRef.current = true;
      fetchLiveNewsfeedTopics({ allCategories: true, silent: true });
    }
    const onVideoPublished = () => {
      loadOverview();
    };
    window.addEventListener('affiliate:video-published', onVideoPublished);
    const timer = setInterval(loadOverview, 3500);
    return () => {
      window.removeEventListener('affiliate:video-published', onVideoPublished);
      clearInterval(timer);
    };
  }, []);

  const handleSampleVoice = async () => {
    setIsSamplingVoice(true);
    try {
      const res = await fetch('/api/shorts-studio/voice-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, text: sampleText }),
      });
      const data = await res.json();
      if (!data.ok || !data.audioUrl) {
        throw new Error(data.error || 'Không tạo được mẫu giọng');
      }
      const urlWithBust = `${data.audioUrl}?t=${Date.now()}`;
      setSampleAudioUrl(urlWithBust);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load();
          audioRef.current.play().catch(() => {});
        }
      }, 80);
    } catch (err: any) {
      showToast('❌ Lỗi nghe thử giọng: ' + err.message);
    } finally {
      setIsSamplingVoice(false);
    }
  };

  const handleCreateVideo = async () => {
    if (!topic.trim()) {
      showToast('⚠️ Bạn hãy nhập Ý tưởng hoặc dán Nội dung kịch bản vào ô trước nhé!');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/shorts-studio/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: topic.trim(),
          topic: topic.trim(),
          id: customId.trim() || undefined,
          customId: customId.trim() || undefined,
          style,
          mode,
          duration,
          aspectRatio: targetAspectRatio,
          voiceId: voice,
          voice,
          model: aiModel,
          reviewMode,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Không thể khởi tạo tiến trình render');
      }
      setActiveJobId(data.job.jobId);
      prevJobStatusRef.current[data.job.jobId] = 'running';
      setTopic('');
      setCustomId('');
      showToast(`🚀 Đã bắt đầu tạo & render video "${data.job.videoId}". Sau khi xong sẽ tự đẩy lên S3 & DB!`);
      await loadOverview();
    } catch (err: any) {
      showToast('❌ Lỗi tạo video: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSyncToS3AndDb = async (shortId: string, customPayload?: { title?: string; caption?: string; tags?: string[] }) => {
    setSyncingId(shortId);
    try {
      showToast(`☁️ Đang đẩy video "${shortId}" (kèm tiêu đề & nội dung) lên S3 và DB...`);
      const res = await fetch(`/api/shorts-studio/sync/${encodeURIComponent(shortId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(customPayload || {}),
          forceS3Upload: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Đồng bộ S3/DB thất bại');
      }
      showToast(`✅ Đã đồng bộ "${data.video?.title || shortId}" lên S3 & DB thành công!`);
      await loadOverview();
      onVideoSynced();
      return data.video as VideoItem;
    } catch (err: any) {
      showToast('❌ Lỗi đồng bộ S3 & DB: ' + err.message);
      return null;
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteShortsVideo = async (shortId: string) => {
    const ok = await confirmDialog({
      title: 'Xóa Video khỏi hệ thống?',
      message: `Bạn có chắc chắn muốn xóa vĩnh viễn video "${shortId}" khỏi DB, S3 Metadata, thư mục mã nguồn và file MP4 đã render? Hành động này không thể hoàn tác.`,
      confirmText: '🗑️ Xóa Vĩnh Viễn',
      cancelText: 'Huỷ',
      type: 'danger',
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/shorts-studio/video/${encodeURIComponent(shortId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.ok && !data.success) {
        throw new Error(data.error || 'Không thể xóa video');
      }
      showToast(`🗑️ Đã xóa vĩnh viễn video "${shortId}" khỏi DB!`);
      if (editingVideoId === shortId) {
        setEditingVideoId(null);
        setDetailData(null);
      }
      await loadOverview();
      onVideoSynced();
    } catch (err: any) {
      showToast('❌ Lỗi xóa video: ' + err.message);
    }
  };

  const handleOpenDetail = async (shortId: string) => {
    setEditingVideoId(shortId);
    setDetailData(null);
    const openedVersion = Date.now();
    try {
      const res = await fetch(`/api/shorts-studio/video/${encodeURIComponent(shortId)}`);
      const data = await res.json();
      if (data.success) {
        setDetailData({ ...data, _cacheKey: data.updatedAt || data.created || openedVersion });
        setEditTitle(data.title || shortId);
        setEditCaption(data.captionText || data.caption || '');
        setEditTags(Array.isArray(data.tags) ? data.tags.join(' ') : '#viral #xuhuong #trending #shorts #short #fyp #kienthuc');
        setEditVoice(data.narration?.voice || voice || 'MaiBePhuong');
        setEditSentences(
          Array.isArray(data.narration?.sentences)
            ? data.narration.sentences.map((s: any, idx: number) => ({
                id: s.id || `s${idx + 1}`,
                text: s.text || '',
              }))
            : []
        );
      }
    } catch (err: any) {
      showToast('❌ Lỗi tải chi tiết video: ' + err.message);
    }
  };

  const handleSaveTitleAndCaptionToDb = async () => {
    if (!editingVideoId) return;
    setIsSavingMeta(true);
    try {
      const parsedTags = editTags
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));

      const syncedVideo = await handleSyncToS3AndDb(editingVideoId, {
        title: editTitle.trim(),
        caption: editCaption.trim(),
        tags: parsedTags,
      });
      if (syncedVideo) {
        setDetailData((prev: any) => (prev ? { ...prev, dbVideo: syncedVideo, title: syncedVideo.title } : prev));
      }
    } finally {
      setIsSavingMeta(false);
    }
  };

  const handleRebuildVideo = async () => {
    if (!editingVideoId) return;
    const validSentences = editSentences.map((s) => ({ id: s.id, text: s.text.trim() })).filter((s) => s.text.length > 0);
    if (validSentences.length < 2) {
      showToast('⚠️ Kịch bản cần ít nhất 2 câu thoại!');
      return;
    }
    setIsRebuilding(true);
    try {
      const res = await fetch('/api/shorts-studio/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: editingVideoId,
          voice: editVoice,
          sentences: validSentences,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Không thể chạy lại tiến trình render');
      }
      setActiveJobId(data.job.jobId);
      prevJobStatusRef.current[data.job.jobId] = 'running';
      setEditingVideoId(null);
      showToast(`🔄 Đang đọc lại giọng & render lại video "${editingVideoId}" (Xong sẽ tự đẩy S3 & DB)...`);
      await loadOverview();
    } catch (err: any) {
      showToast('❌ Lỗi render lại: ' + err.message);
    } finally {
      setIsRebuilding(false);
    }
  };

  const [restartingId, setRestartingId] = useState<string | null>(null);
  const handleRestartJob = async (shortId: string) => {
    if (restartingId) return;
    setRestartingId(shortId);
    try {
      const res = await fetch(`/api/shorts-studio/restart/${encodeURIComponent(shortId)}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Không thể chạy lại');
      setActiveJobId(data.job.jobId);
      prevJobStatusRef.current[data.job.jobId] = 'running';
      showToast(
        data.resumedFrom === 'tts'
          ? `🔄 Đã có kịch bản — chạy tiếp TTS → Render → Encode cho "${shortId}"`
          : `🔄 Chạy lại "${shortId}" từ ý tưởng gốc (Opus viết kịch bản)`
      );
      await loadOverview();
    } catch (err: any) {
      showToast('❌ Lỗi chạy lại: ' + err.message);
    } finally {
      setRestartingId(null);
    }
  };
  const [chapterBusy, setChapterBusy] = useState(false);
  const handleChapterAction = async (shortId: string, action: 'next' | 'redo') => {
    if (chapterBusy) return;
    setChapterBusy(true);
    try {
      const res = await fetch(`/api/shorts-studio/${action}/${encodeURIComponent(shortId)}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Không thể gửi lệnh');
      showToast(action === 'next' ? '▶ Đang tạo tiếp…' : '🔁 Đang dựng lại chương này…');
      await loadOverview();
    } catch (err: any) {
      showToast('❌ ' + err.message);
    } finally {
      setChapterBusy(false);
    }
  };
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const handleStopJob = async (shortId: string) => {
    if (stoppingId) return;
    if (!window.confirm(`Dừng tạo video "${shortId}"? Có thể bấm "Chạy lại" để làm tiếp sau.`)) return;
    setStoppingId(shortId);
    try {
      const res = await fetch(`/api/shorts-studio/cancel/${encodeURIComponent(shortId)}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Không thể dừng');
      showToast(`⏹ Đã dừng "${shortId}"`);
      await loadOverview();
    } catch (err: any) {
      showToast('❌ Lỗi dừng: ' + err.message);
    } finally {
      setStoppingId(null);
    }
  };
  const isVideoRunning = (shortId: string) => jobs.some((j) => j.videoId === shortId && (j.status === 'running' || j.status === 'review'));

  const handleTogglePublishedFlag = async (shortId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (togglingPublishId === shortId) return;
    setTogglingPublishId(shortId);
    try {
      const res = await fetch(`/api/shorts-studio/video/${encodeURIComponent(shortId)}/toggle-published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Không thể cập nhật cờ đã đăng');
      }
      if (data.video) {
        setVideos((prev) =>
          prev.map((item) => (item.id === shortId ? { ...item, dbVideo: data.video } : item))
        );
        setDetailData((prev: any) =>
          prev && editingVideoId === shortId ? { ...prev, dbVideo: data.video } : prev
        );
      }
      showToast(
        data.is_published
          ? `✅ Đã gắn cờ "Đã đăng" cho video "${shortId}"!`
          : `🏳️ Đã chuyển "${shortId}" về trạng thái "Chưa đăng".`
      );
      await loadOverview();
      onVideoSynced();
    } catch (err: any) {
      showToast('❌ Lỗi cập nhật cờ đăng video: ' + err.message);
    } finally {
      setTogglingPublishId(null);
    }
  };

  const resolveVideoPlaylistForPublish = (vid: VideoItem, textFallback: string) => {
    const fmt: 'short' | 'long' = isLongStudio || vid.video_format === 'long' || vid.aspect_ratio === '16:9' ? 'long' : 'short';
    if (vid.playlist_name && vid.playlist_name.trim()) {
      return formatYoutubePlaylistName(vid.playlist_name, fmt, textFallback);
    }
    return inferDefaultYoutubePlaylist(textFallback, fmt);
  };

  const handleOpenMultiPlatformPublish = async (v: ShortsVideoEntry) => {
    const hint = `${v.title || ''} ${v.caption || ''}`;
    if (v.dbVideo) {
      onOpenPublishModal({
        ...v.dbVideo,
        playlist_name: resolveVideoPlaylistForPublish(v.dbVideo, hint),
      });
      return;
    }
    const synced = await handleSyncToS3AndDb(v.id);
    if (synced) {
      onOpenPublishModal({
        ...synced,
        playlist_name: resolveVideoPlaylistForPublish(synced, hint),
      });
    }
  };

  const formatScopedJobs = jobs.filter((j) =>
    isLongStudio ? j.aspectRatio === '16:9' : j.aspectRatio !== '16:9'
  );
  const activeJob =
    (activeJobId && jobs.find((j) => j.jobId === activeJobId)) ||
    formatScopedJobs.find((j) => j.status === 'running' || j.status === 'review') ||
    null;

  // ── "Còn sống" indicators: per-step elapsed timer, ticking every second while running ──
  const [nowTick, setNowTick] = useState(Date.now());
  const stepStartRef = useRef<{ key: string; at: number }>({ key: '', at: Date.now() });
  const activeRunning = activeJob?.status === 'running';
  const stepKey = activeJob ? `${activeJob.jobId}::${activeJob.step}` : '';
  if (stepKey && stepStartRef.current.key !== stepKey) {
    stepStartRef.current = { key: stepKey, at: Date.now() };
  }
  useEffect(() => {
    if (!activeRunning) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRunning]);
  const fmtElapsed = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const stepElapsed = fmtElapsed(nowTick - stepStartRef.current.at);
  const totalElapsed = activeJob?.startedAt ? fmtElapsed(nowTick - activeJob.startedAt) : null;

  const formatScopedVideos = videos.filter((v) =>
    isLongStudio ? v.aspectRatio === '16:9' : v.aspectRatio !== '16:9'
  );

  const filteredVideos = formatScopedVideos.filter((v) => {
    if (styleFilter !== 'all' && (v.style || 'other') !== styleFilter) return false;
    const pub = getVideoPublishFlags(v.dbVideo);
    if (filterState === 'published') {
      if (!pub.isPublished) return false;
    } else if (filterState === 'unpublished') {
      if (pub.isPublished) return false;
    } else if (filterState !== 'all' && v.state !== filterState) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        v.id.toLowerCase().includes(q) ||
        (v.title && v.title.toLowerCase().includes(q)) ||
        (v.caption && v.caption.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const counts = {
    all: formatScopedVideos.length,
    progress: formatScopedVideos.filter((v) => v.state === 'progress').length,
    attention: formatScopedVideos.filter((v) => v.state === 'attention').length,
    ready: formatScopedVideos.filter((v) => v.state === 'ready').length,
    published: formatScopedVideos.filter((v) => getVideoPublishFlags(v.dbVideo).isPublished).length,
    unpublished: formatScopedVideos.filter((v) => !getVideoPublishFlags(v.dbVideo).isPublished).length,
  };

  return (
    <div style={{ marginBottom: '28px' }}>
      {/* ─── BOX 1: TẠO & RENDER VIDEO MỚI (AI STUDIO) ─── */}
      <div
        style={{
          background: 'linear-gradient(145deg, #111722 0%, #0d1117 100%)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '14px',
          padding: '18px 20px',
          marginBottom: '16px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#f0f6fc' }}>
              {isLongStudio
                ? '🖥️ Tạo & Render Video Dài Màn Ngang 16:9 (1920×1080 · Người Que AI)'
                : '✨ Tạo & Render Video Shorts Mới (9:16 · AI Studio)'}
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: isLongStudio ? 'rgba(245, 158, 11, 0.18)' : 'rgba(56, 189, 248, 0.16)',
                color: isLongStudio ? '#fde047' : '#7dd3fc',
                border: isLongStudio ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(56, 189, 248, 0.35)',
                fontWeight: 700,
              }}
            >
              {isLongStudio ? '📺 Khung ngang 16:9 (1920×1080)' : '📱 Khung dọc 9:16 (1080×1920)'}
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(139, 92, 246, 0.16)',
                color: '#c4b5fd',
                border: '1px solid rgba(139, 92, 246, 0.35)',
              }}
            >
              Kịch bản: Claude Opus 5.5 (Fallback: Carbon 4.0 → Argon 4.0)
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(16, 185, 129, 0.14)',
                color: '#6ee7b7',
                border: '1px solid rgba(16, 185, 129, 0.35)',
              }}
            >
              Đạo diễn & Đồ họa: Gemini 4.0 Argon
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(56, 189, 248, 0.14)',
                color: '#7dd3fc',
                border: '1px solid rgba(56, 189, 248, 0.35)',
              }}
            >
              ☁️ Tự động đẩy S3 & DB + Sync Đa Nền Tảng
            </span>
          </div>
        </div>

        {/* Row 1: Style / Mode / Duration / Custom ID */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>1. Phong cách hình ảnh (Style)</div>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <option value="stickman">
                {isLongStudio
                  ? '🚶‍♂️ Hoạt hình Người Que Màn Ngang 16:9 (1920×1080 Full HD)'
                  : '🚶‍♂️ Hoạt hình Người Que (Stickman & Nhân vật kể chuyện)'}
              </option>
              <option value="stickman-explainer">
                🎓 Thầy Lá kể chuyện khoa học (Người que + ảnh nền AI)
              </option>
              <option value="spirit">
                🕯️ Giải mã tâm linh (Người que kể chuyện lạ rồi giải mã khoa học, nền AI theo thoại)
              </option>
              <option value="story">
                📖 Kể chuyện bằng tranh (Gemini vẽ từng cảnh + clip Veo, giữ nhân vật)
              </option>
              {!isLongStudio && (
                <option value="classic">📊 Infographic / Biểu đồ Chuyên sâu (Classic)</option>
              )}
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>2. Chế độ xử lý nội dung</div>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
              }}
            >
              <option value="auto">🤖 Thông minh (Ý tưởng → AI viết / Content dài → AI chia cảnh)</option>
              <option value="topic">💡 Từ Ý tưởng ngắn (AI tự sáng tác toàn bộ kịch bản)</option>
              <option value="content">📝 Từ bài Content có sẵn (Giữ sát nguyên văn nội dung của bạn)</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>⏱️ 3. Thời lượng video</div>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <option value="auto">🤖 Tự động (AI tính theo độ dài nội dung nhập vào)</option>
              {!isLongStudio && <option value="short">⚡ Ngắn gọn (~35 - 45 giây · 7 câu)</option>}
              {!isLongStudio && <option value="medium">🔥 Chuẩn Viral (1 – 1.5 phút · ~16 câu)</option>}
              <option value="long">🎬 Tiêu chuẩn (2 – 2.5 phút · ~25 câu)</option>
              <option value="story">📚 Kể chuyện / Phân tích dài (3 – 4 phút · ~38 câu)</option>
              <option value="deep">🎙️ Podcast / Giải mã sâu (5 – 6 phút · ~62 câu)</option>
              <option value="epic">🏆 Chuyên đề YouTube Dài (8 – 10 phút · ~105 câu)</option>
              {isLongStudio && <option value="m15">🎞️ 15 phút</option>}
              {isLongStudio && <option value="m20">🎞️ 20 phút</option>}
              {isLongStudio && <option value="m30">🎞️ ~28–30 phút (truyện dài)</option>}
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>📋 Chế độ tạo</div>
            <select
              value={reviewMode}
              onChange={(e) => changeReviewMode(e.target.value as 'chapter' | 'all')}
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <option value="chapter">👀 Duyệt từng chương (~2 phút/chương, bấm Tiếp tục mới tạo tiếp)</option>
              <option value="all">⚡ Tự động toàn bộ (tạo từ đầu tới cuối, không cần duyệt)</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>🧠 Model AI (Kịch bản + Đạo diễn hình)</div>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <option value="claude-opus-5-5-medium">💎 Opus 5.5 Medium — đẹp nhất, chậm nhất</option>
              <option value="claude-opus-5-5-low">⚖️ Opus 5.5 Low — nhanh hơn một chút</option>
              <option value="claude-sonnet-5-5-medium">⚡ Sonnet 5.5 — nhanh nhất</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>4. Tên ID video (Bỏ trống tự tạo)</div>
            <input
              type="text"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="vd: nguoi-que-thuc-khuya"
              style={{
                width: '100%',
                background: '#0b0f17',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '13px',
              }}
            />
          </div>
        </div>

        {/* Row 2: Voice Selector + Sample Voice */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr auto',
            gap: '10px',
            marginBottom: '10px',
            alignItems: 'end',
            background: '#0b0f17',
            border: '1px solid #1f2937',
            borderRadius: '10px',
            padding: '10px 12px',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
              🎙️ 5. Giọng đọc AI (VieNeu-TTS Local · Kèm 3 giọng bạn đã Train + 25 giọng mẫu)
            </div>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              style={{
                width: '100%',
                background: '#111722',
                border: '1px solid #2e3c52',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#38bdf8',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
              Câu thoại nghe thử (có thể sửa tuỳ ý)
            </div>
            <input
              type="text"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              style={{
                width: '100%',
                background: '#111722',
                border: '1px solid #263042',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e6edf3',
                fontSize: '12px',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleSampleVoice}
              disabled={isSamplingVoice}
              style={{
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSamplingVoice ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isSamplingVoice ? '⏳ Đang tạo mẫu...' : '🔊 Nghe thử giọng'}
            </button>
            {sampleAudioUrl && (
              <audio ref={audioRef} src={sampleAudioUrl} controls style={{ height: '32px', maxWidth: '190px' }} />
            )}
          </div>
        </div>

        {/* Row 2.5: Playlist / Series Grouping for YouTube */}
        <div
          style={{
            background: '#0b0f17',
            border: isLongStudio ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '10px',
            padding: '10px 12px',
            marginBottom: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '11.5px', fontWeight: 700, color: isLongStudio ? '#38bdf8' : '#fbbf24', whiteSpace: 'nowrap' }}>
            {isLongStudio
              ? '🖥️ Playlist YouTube — Video Dài 16:9 (Tách riêng với Shorts):'
              : '📱 Playlist YouTube — Shorts 9:16 (Tách riêng với Video Dài):'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {STUDIO_PLAYLIST_PRESETS.map((p) => {
              const active = playlistName === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlaylistName(p.value)}
                  style={{
                    background: active
                      ? isLongStudio
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'rgba(245, 158, 11, 0.22)'
                      : '#141922',
                    border: active
                      ? isLongStudio
                        ? '1px solid #38bdf8'
                        : '1px solid #f59e0b'
                      : '1px solid #263042',
                    color: active ? (isLongStudio ? '#e0f2fe' : '#fde68a') : '#8b949e',
                    borderRadius: '999px',
                    padding: '3px 9px',
                    fontSize: '11px',
                    fontWeight: active ? 700 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            placeholder={`Hoặc nhập tên Playlist riêng (VD: ${playlistTag} Hóng Hớt 2026)...`}
            style={{
              flex: '1 1 220px',
              background: '#111722',
              border: '1px solid #263042',
              borderRadius: '8px',
              padding: '5px 10px',
              color: isLongStudio ? '#e0f2fe' : '#fef3c7',
              fontSize: '12px',
              fontWeight: 600,
            }}
          />
        </div>

        {/* Row 3: Topic / Content Textarea */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#8b949e' }}>
              Nhập Ý tưởng ngắn (AI tự quất hết từ A–Z) HOẶC dán nguyên bài Content (AI tự chia cảnh & số liệu):
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {TOPIC_CATEGORIES.map((cat) => {
                const active = topicCat === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setTopicCat(cat.key);
                      setPlaylistName(CATEGORY_TO_PLAYLIST[cat.key] || defaultStudioPlaylist);
                      const countInCat = liveTrendingTopics.filter((t) => t.cat === cat.key).length;
                      if (countInCat < 3 && !isFetchingRandomTopic) {
                        fetchLiveNewsfeedTopics({ category: cat.key, silent: true });
                      }
                    }}
                    style={{
                      background: active ? 'rgba(56, 189, 248, 0.22)' : '#141922',
                      border: active ? '1px solid rgba(56, 189, 248, 0.65)' : '1px solid #263042',
                      color: active ? '#7dd3fc' : '#8b949e',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: active ? 700 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={isFetchingRandomTopic}
                onClick={() =>
                  fetchLiveNewsfeedTopics({
                    category: topicCat,
                    replaceCategory: true,
                    autoPick: false,
                  })
                }
                title="Quét lại danh sách tin tức mới nhất hôm nay cho danh mục này"
                style={{
                  background: 'rgba(16, 185, 129, 0.14)',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  color: '#6ee7b7',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isFetchingRandomTopic ? 'wait' : 'pointer',
                  opacity: isFetchingRandomTopic ? 0.7 : 1,
                }}
              >
                🔄 Quét Newfeed
              </button>
              <button
                type="button"
                disabled={isFetchingRandomTopic}
                onClick={() =>
                  fetchLiveNewsfeedTopics({
                    category: topicCat,
                    replaceCategory: true,
                    autoPick: true,
                  })
                }
                style={{
                  background: isFetchingRandomTopic
                    ? 'rgba(250, 204, 21, 0.28)'
                    : 'rgba(250, 204, 21, 0.14)',
                  border: '1px solid rgba(250, 204, 21, 0.55)',
                  color: '#fde047',
                  borderRadius: '6px',
                  padding: '3px 9px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isFetchingRandomTopic ? 'wait' : 'pointer',
                  opacity: isFetchingRandomTopic ? 0.85 : 1,
                }}
              >
                {isFetchingRandomTopic ? '⏳ Đang săn tin Hot mới...' : '🎲 Chọn ngẫu nhiên (Săn tin mới AI)'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px', alignItems: 'center' }}>
            {(() => {
              const liveForCat = liveTrendingTopics.filter((t) => t.cat === topicCat);
              const displaySource =
                liveForCat.length > 0
                  ? liveForCat
                  : liveTrendingTopics.length > 0 && !isFetchingRandomTopic
                    ? liveTrendingTopics.slice(0, 6)
                    : liveFeedFailed && !isFetchingRandomTopic
                      ? SUGGESTED_TOPICS.filter((t) => t.cat === topicCat)
                      : [];

              if (displaySource.length === 0 && isFetchingRandomTopic) {
                return (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: '#fde047',
                      background: 'rgba(250, 204, 21, 0.1)',
                      border: '1px dashed rgba(250, 204, 21, 0.4)',
                      borderRadius: '999px',
                      padding: '4px 12px',
                      fontWeight: 600,
                    }}
                  >
                    📡 Đang quét tin mới nhất từ VnExpress, Tuổi Trẻ, Dân Trí, Google News VN & tổng hợp bằng AI...
                  </div>
                );
              }

              return displaySource
                .filter((item, idx, arr) => {
                  const alreadyInLibrary = videos.some(
                    (v) => v.id === item.id || v.id === `shorts_${item.id}` || v.id === `long_${item.id}`,
                  );
                  if (alreadyInLibrary && customId !== item.id) return false;
                  return arr.findIndex((x) => x.id === item.id) === idx;
                })
                .map((item) => {
                  const isLive = 'sourceName' in item && Boolean(item.sourceName);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setTopic(item.prompt);
                        setCustomId(item.id);
                        // ghost stories → spirit style, length from the full story
                        if ((item as any).cat === 'spirit') {
                          setStyle('spirit');
                          setDuration('auto');
                          setVoice('vieneu:Anh Minh');
                        }
                      }}
                      title={
                        isLive
                          ? `Nguồn báo chí hôm nay: ${(item as any).sourceName}${
                              (item as any).sourceTitle ? ` — "${(item as any).sourceTitle}"` : ''
                            }`
                          : undefined
                      }
                      style={{
                        background:
                          customId === item.id
                            ? 'rgba(56, 189, 248, 0.26)'
                            : isLive
                              ? 'rgba(250, 204, 21, 0.13)'
                              : 'rgba(56, 189, 248, 0.1)',
                        border:
                          customId === item.id
                            ? '1px solid #38bdf8'
                            : isLive
                              ? '1px solid rgba(250, 204, 21, 0.45)'
                              : '1px solid rgba(56, 189, 248, 0.3)',
                        color: customId === item.id ? '#ffffff' : isLive ? '#fef08a' : '#bae6fd',
                        borderRadius: '999px',
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isLive ? `🆕 ${item.label}` : item.label}
                    </button>
                  );
                });
            })()}
          </div>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={
              'Cách 1 (Đưa ý tưởng): Vì sao ngân hàng trung ương in thêm tiền lại làm phở tăng giá?\nCách 2 (Dán cả bài Content): Dán nguyên cốt truyện hoặc bài viết dài của bạn vào đây, hệ thống sẽ tự chia thành 7 phân cảnh, rút số liệu vẽ biểu đồ và render trọn vẹn từ đầu tới cuối...'
            }
            style={{
              width: '100%',
              background: '#0b0f17',
              border: '1px solid #263042',
              borderRadius: '8px',
              padding: '10px 12px',
              color: '#e6edf3',
              fontSize: '13px',
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Row 4: Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '12px', color: '#8b949e' }}>
            Hệ thống sẽ tự động: Khởi tạo khung → Viết kịch bản → Đọc TTS → Code hoạt cảnh → Render MP4 → Chuẩn hóa -13 LUFS → <b>Đẩy lên S3 & DB (kèm Tiêu đề & Nội dung)</b>.
          </div>
          <button
            type="button"
            onClick={handleCreateVideo}
            disabled={isSubmitting}
            style={{
              background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: isSubmitting ? 'wait' : 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
            }}
          >
            {isSubmitting ? '⏳ Đang khởi tạo...' : '🚀 Tạo & Render Video Ngay'}
          </button>
        </div>

        {/* Live Job Progress Box */}
        {activeJob && (
          <div
            style={{
              marginTop: '14px',
              background: '#090d14',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              padding: '12px 14px',
            }}
          >
            <style>{`
              @keyframes sk-spin { to { transform: rotate(360deg); } }
              @keyframes sk-stripes { from { background-position: 0 0; } to { background-position: 28px 0; } }
              @keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '13px',
                  color:
                    activeJob.status === 'done'
                      ? '#3fb950'
                      : activeJob.status === 'error'
                      ? '#f85149'
                      : '#38bdf8',
                }}
              >
                {activeJob.status === 'done' ? '✅ ' : activeJob.status === 'error' ? '❌ ' : (
                  <span style={{ display: 'inline-block', animation: 'sk-spin 1.6s linear infinite', marginRight: '4px' }}>⚙️</span>
                )}
                [{activeJob.videoId}] {activeJob.step}
                {(activeJob.status === 'running' || activeJob.status === 'review') && (
                  <button
                    type="button"
                    disabled={stoppingId === activeJob.videoId}
                    onClick={() => handleStopJob(activeJob.videoId)}
                    style={{
                      marginLeft: '10px',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(248, 113, 113, 0.5)',
                      background: 'rgba(248, 113, 113, 0.12)',
                      color: '#fca5a5',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {stoppingId === activeJob.videoId ? '⏳ Đang dừng...' : '⏹ Dừng'}
                  </button>
                )}
                {activeJob.status === 'error' && (
                  <button
                    type="button"
                    disabled={restartingId === activeJob.videoId}
                    onClick={() => handleRestartJob(activeJob.videoId)}
                    style={{
                      marginLeft: '10px',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(56, 189, 248, 0.5)',
                      background: 'rgba(56, 189, 248, 0.12)',
                      color: '#7dd3fc',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {restartingId === activeJob.videoId ? '⏳ Đang chạy lại...' : '🔄 Chạy lại'}
                  </button>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#8b949e', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {activeRunning && (
                  <span title="Thời gian của bước hiện tại / tổng thời gian job" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#7dd3fc' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', animation: 'sk-pulse 1.2s ease-in-out infinite' }} />
                    ⏱ {stepElapsed}
                    {totalElapsed && <span style={{ color: '#64748b' }}>· tổng {totalElapsed}</span>}
                  </span>
                )}
                {activeJob.progress || 0}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                background: '#1b222c',
                borderRadius: '999px',
                overflow: 'hidden',
                marginBottom: '8px',
              }}
            >
              <div
                style={{
                  width: `${activeJob.progress || 5}%`,
                  height: '100%',
                  background:
                    activeJob.status === 'error'
                      ? '#f85149'
                      : activeJob.status === 'done'
                      ? '#238636'
                      : 'repeating-linear-gradient(45deg, #0284c7 0 10px, #38bdf8 10px 20px)',
                  backgroundSize: activeRunning ? '28px 100%' : undefined,
                  animation: activeRunning ? 'sk-stripes 0.8s linear infinite' : undefined,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            {activeJob.status === 'review' && (
              <div style={{ marginTop: '12px', padding: '12px', border: '1px solid #1f6feb', borderRadius: '10px', background: 'rgba(31,111,235,0.08)' }}>
                {(() => {
                  const chs = activeJob.chapters || [];
                  const cur = chs.find((c) => c.n === activeJob.reviewIndex);
                  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
                  const isLast = cur ? cur.n === chs.length : false;
                  return (
                    <>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#79c0ff', marginBottom: '8px' }}>
                        ⏸ Chương {cur?.n}/{chs.length} {cur ? `(${fmt(cur.from)} – ${fmt(cur.to)})` : ''} — xem bản nháp, ghi lại chỗ cần sửa rồi chọn:
                      </div>
                      {cur?.url ? (
                        <video key={cur.url} src={cur.url} controls style={{ width: '100%', maxHeight: '420px', borderRadius: '8px', background: '#000' }} />
                      ) : null}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                        <button
                          type="button"
                          disabled={chapterBusy}
                          onClick={() => handleChapterAction(activeJob.videoId, 'next')}
                          style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#238636', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                        >
                          {isLast ? '✅ Duyệt xong → dựng bản hoàn chỉnh' : '▶ Tiếp tục (Next)'}
                        </button>
                        <button
                          type="button"
                          disabled={chapterBusy}
                          onClick={() => handleChapterAction(activeJob.videoId, 'redo')}
                          title="Dựng lại bản nháp chương này (dùng sau khi đã chỉnh sửa)"
                          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #30363d', background: '#161b22', color: '#c9d1d9', fontWeight: 700, cursor: 'pointer' }}
                        >
                          🔁 Dựng lại chương này
                        </button>
                      </div>
                      {chs.filter((c) => c.url && c.n !== activeJob.reviewIndex).length > 0 && (
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#8b949e' }}>
                          Chương đã duyệt:{' '}
                          {chs.filter((c) => c.url && c.n < (activeJob.reviewIndex ?? 0)).map((c) => (
                            <a key={c.n} href={c.url as string} target="_blank" rel="noreferrer" style={{ marginRight: '10px', color: '#58a6ff' }}>
                              Chương {c.n}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {Array.isArray(activeJob.logs) && activeJob.logs.length > 0 && (
              <div
                style={{
                  maxHeight: '110px',
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '11px',
                  color: '#8b949e',
                  lineHeight: 1.45,
                  background: '#05080d',
                  padding: '8px 10px',
                  borderRadius: '6px',
                }}
              >
                {activeJob.logs.slice(-10).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── BOX 2: DANH SÁCH VIDEO SHORTS-KIT (ĐỒNG BỘ S3 & DB) ─── */}
      <div
        style={{
          background: '#0d1117',
          border: '1px solid #222933',
          borderRadius: '14px',
          padding: '16px 18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f0f6fc' }}>
              {isLongStudio
                ? `Danh sách Video Dài 16:9 (${filteredVideos.length})`
                : `Danh sách Video Shorts 9:16 (${filteredVideos.length})`}
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(['all', 'unpublished', 'published', 'progress', 'ready'] as const).map((tab) => {
                const isSelected = filterState === tab;
                const activeBg =
                  tab === 'published'
                    ? 'rgba(16, 185, 129, 0.18)'
                    : tab === 'unpublished'
                      ? 'rgba(245, 158, 11, 0.16)'
                      : 'rgba(56, 189, 248, 0.16)';
                const activeColor =
                  tab === 'published' ? '#34d399' : tab === 'unpublished' ? '#fbbf24' : '#38bdf8';
                const activeBorder =
                  tab === 'published'
                    ? '1px solid rgba(16, 185, 129, 0.5)'
                    : tab === 'unpublished'
                      ? '1px solid rgba(245, 158, 11, 0.45)'
                      : '1px solid rgba(56, 189, 248, 0.45)';

                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setFilterState(tab)}
                    style={{
                      background: isSelected ? activeBg : '#141922',
                      color: isSelected ? activeColor : '#8b949e',
                      border: isSelected ? activeBorder : '1px solid #263042',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: isSelected ? 600 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {tab === 'all' && `All (${counts.all})`}
                    {tab === 'unpublished' && `🏳️ Chưa đăng (${counts.unpublished})`}
                    {tab === 'published' && `✅ Đã đăng (${counts.published})`}
                    {tab === 'progress' && `In progress (${counts.progress})`}
                    {tab === 'ready' && `Ready (${counts.ready})`}
                  </button>
                );
              })}
            </div>
          </div>

          <select
            value={styleFilter}
            onChange={(e) => setStyleFilter(e.target.value)}
            title="Lọc theo loại video"
            style={{ background: '#141922', border: '1px solid #263042', borderRadius: '8px', padding: '6px 10px', color: '#e6edf3', fontSize: '12px' }}
          >
            {[
              ['all', 'Tất cả loại'],
              ['stickman', '🚶 Người que'],
              ['spirit', '🕯️ Giải mã tâm linh'],
              ['story', '📖 Kể chuyện bằng tranh'],
              ['stickman-explainer', '🎓 Thầy Lá'],
              ['classic', '📊 Infographic'],
              ['other', 'Khác'],
            ].map(([k, label]) => (
              <option key={k} value={k}>
                {label} ({k === 'all' ? formatScopedVideos.length : formatScopedVideos.filter((v) => (v.style || 'other') === k).length})
              </option>
            ))}
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo ID, tiêu đề hoặc nội dung..."
            style={{
              minWidth: '240px',
              background: '#141922',
              border: '1px solid #263042',
              borderRadius: '8px',
              padding: '6px 12px',
              color: '#e6edf3',
              fontSize: '12px',
            }}
          />
        </div>

        {filteredVideos.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#8b949e', fontSize: '13px' }}>
            Chưa có video nào trong danh sách. Hãy nhập ý tưởng ở khung trên để tạo video mới!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredVideos.map((v, idx) => {
              const pct = Math.round(((v.progress?.done || 0) / Math.max(1, v.progress?.total || 13)) * 100);
              const hasRenderedFile = Boolean(v.files?.uploadMp4 || v.files?.draftMp4);
              const isSyncingThis = syncingId === v.id;
              const pub = getVideoPublishFlags(v.dbVideo);
              const isTogglingThis = togglingPublishId === v.id;

              return (
                <div
                  key={v.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1.6fr 170px auto',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 14px',
                    background: pub.isPublished
                      ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.08) 0%, #121821 38%)'
                      : '#121821',
                    border: pub.isPublished ? '1px solid rgba(16, 185, 129, 0.42)' : '1px solid #222b38',
                    borderLeft: pub.isPublished ? '4px solid #10b981' : '1px solid #222b38',
                    borderRadius: '10px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: pub.isPublished ? '#34d399' : '#6e7681', fontFamily: 'monospace', fontWeight: pub.isPublished ? 700 : 400 }}>
                    #{idx + 1}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                      <span
                        onClick={() => handleOpenDetail(v.id)}
                        style={{
                          fontWeight: 700,
                          fontSize: '14px',
                          color: '#f0f6fc',
                          cursor: 'pointer',
                        }}
                      >
                        {v.title || v.id}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: '#1b222c',
                          color: '#8b949e',
                          border: '1px solid #2b3442',
                          fontFamily: 'monospace',
                        }}
                      >
                        {v.id}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: v.s3Synced ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)',
                          color: v.s3Synced ? '#34d399' : '#fbbf24',
                          border: v.s3Synced ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
                        }}
                      >
                        {v.s3Synced ? '☁️ Đã đẩy S3 & DB' : hasRenderedFile ? '💾 Đã lưu DB' : '⏳ Chưa render MP4'}
                      </span>

                      {/* Cờ trạng thái đăng video (Click 1 chạm để gắn cờ / bỏ cờ thủ công) */}
                      {(hasRenderedFile || pub.isPublished) && (
                        <button
                          type="button"
                          disabled={isTogglingThis}
                          onClick={(e) => handleTogglePublishedFlag(v.id, e)}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1.5px 8px',
                            borderRadius: '999px',
                            cursor: isTogglingThis ? 'wait' : 'pointer',
                            background: pub.isPublished
                              ? 'rgba(16, 185, 129, 0.22)'
                              : 'rgba(148, 163, 184, 0.1)',
                            color: pub.isPublished ? '#6ee7b7' : '#94a3b8',
                            border: pub.isPublished
                              ? '1px solid rgba(16, 185, 129, 0.55)'
                              : '1px dashed rgba(148, 163, 184, 0.38)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={
                            pub.isPublished
                              ? 'Video đã được đăng! Bấm vào đây nếu muốn bỏ gắn cờ Đã đăng'
                              : 'Chưa đăng — Bấm vào đây để gắn cờ Đã đăng thủ công'
                          }
                        >
                          {isTogglingThis ? '⏳...' : pub.isPublished ? '✅ Đã đăng' : '🏳️ Chưa đăng'}
                        </button>
                      )}

                      {/* Nhãn nền tảng đã đăng (kèm link mở trực tiếp) */}
                      {pub.hasYt && (
                        <a
                          href={pub.ytUrl || 'https://studio.youtube.com'}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1.5px 8px',
                            borderRadius: '999px',
                            background: 'rgba(239, 68, 68, 0.16)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.45)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                          title="Mở video đã đăng trên YouTube"
                        >
                          🔴 YouTube ↗
                        </a>
                      )}

                      {pub.hasFb && (
                        <a
                          href={pub.fbUrl || 'https://www.facebook.com'}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1.5px 8px',
                            borderRadius: '999px',
                            background: 'rgba(59, 130, 246, 0.16)',
                            color: '#93c5fd',
                            border: '1px solid rgba(59, 130, 246, 0.45)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                          title="Mở video đã đăng trên Facebook"
                        >
                          🔵 Facebook ↗
                        </a>
                      )}

                      {pub.hasTt && (
                        <a
                          href="https://www.tiktok.com/tiktokstudio/content"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1.5px 8px',
                            borderRadius: '999px',
                            background: 'rgba(236, 72, 153, 0.16)',
                            color: '#f9a8d4',
                            border: '1px solid rgba(236, 72, 153, 0.45)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                          title="Mở quản lý nội dung TikTok Studio"
                        >
                          🎵 TikTok ↗
                        </a>
                      )}
                    </div>

                    {v.caption && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#9ca3af',
                          marginTop: '4px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={v.caption}
                      >
                        📝 {v.caption}
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        flex: 1,
                        height: '6px',
                        background: '#222933',
                        borderRadius: '999px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: pct >= 85 ? '#238636' : '#2f81f7',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>
                      {v.progress?.done || 0}/{v.progress?.total || 13}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {hasRenderedFile && (
                      <button
                        type="button"
                        onClick={() => handleOpenMultiPlatformPublish(v)}
                        style={{
                          padding: '6px 11px',
                          borderRadius: '8px',
                          border: pub.isPublished
                            ? '1px solid rgba(56, 189, 248, 0.45)'
                            : '1px solid rgba(16, 185, 129, 0.45)',
                          background: pub.isPublished
                            ? 'rgba(56, 189, 248, 0.12)'
                            : 'rgba(16, 185, 129, 0.14)',
                          color: pub.isPublished ? '#7dd3fc' : '#34d399',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title={
                          pub.isPublished
                            ? 'Video đã đăng — Bấm để đăng thêm sang nền tảng khác hoặc xem lại'
                            : 'Mở trình phát & Đăng lên YouTube, Facebook, TikTok với tiêu đề và nội dung đã đồng bộ'
                        }
                      >
                        {pub.isPublished ? '✅ Đăng Thêm / Xem' : '🚀 Đăng Đa Nền Tảng'}
                      </button>
                    )}

                    {hasRenderedFile && (
                      <button
                        type="button"
                        disabled={isSyncingThis}
                        onClick={() => handleSyncToS3AndDb(v.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: '1px solid rgba(56, 189, 248, 0.4)',
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: '#38bdf8',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: isSyncingThis ? 'wait' : 'pointer',
                        }}
                        title="Đẩy lại file MP4, ảnh bìa, tiêu đề và nội dung lên S3 & DB"
                      >
                        {isSyncingThis ? '⏳ Sync...' : '☁️ Sync S3'}
                      </button>
                    )}

                    {isVideoRunning(v.id) && (
                      <button
                        type="button"
                        disabled={stoppingId === v.id}
                        onClick={() => handleStopJob(v.id)}
                        title="Dừng tạo video này (bấm Chạy lại để làm tiếp sau)"
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(248, 113, 113, 0.5)',
                          background: 'rgba(248, 113, 113, 0.12)',
                          color: '#fca5a5',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {stoppingId === v.id ? '⏳ Đang dừng...' : '⏹ Dừng'}
                      </button>
                    )}

                    {!hasRenderedFile && !isVideoRunning(v.id) && (
                      <button
                        type="button"
                        disabled={restartingId === v.id}
                        onClick={() => handleRestartJob(v.id)}
                        title="Job bị lỗi / bị dừng — chạy tiếp từ bước đang dở (có kịch bản rồi thì chỉ TTS → Render → Encode)"
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(56, 189, 248, 0.5)',
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: '#7dd3fc',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {restartingId === v.id ? '⏳ Đang chạy lại...' : '🔄 Chạy lại'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenDetail(v.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid #30363d',
                        background: '#181e27',
                        color: '#e6edf3',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Open
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteShortsVideo(v.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(248, 81, 73, 0.45)',
                        background: 'rgba(248, 81, 73, 0.12)',
                        color: '#ff7b72',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── MODAL CHI TIẾT / CHỈNH SỬA TIÊU ĐỀ, NỘI DUNG & KỊCH BẢN ─── */}
      {editingVideoId && (
        <div
          onClick={() => setEditingVideoId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4, 7, 14, 0.82)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '1120px',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(165deg, #111827 0%, #0b0f19 100%)',
              border: '1px solid rgba(56, 189, 248, 0.28)',
              borderRadius: '18px',
              color: '#e6edf3',
              boxShadow: '0 28px 72px rgba(0, 0, 0, 0.75)',
              overflow: 'hidden',
            }}
          >
            {/* ── Modal Header (1-line sleek bar, never wraps buttons) ── */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                padding: '14px 22px',
                background: 'rgba(15, 23, 42, 0.75)',
                borderBottom: '1px solid #1e293b',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                  🎬 Chi tiết & Đồng bộ Đa Nền Tảng
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: '999px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {editingVideoId}
                </span>
                {detailData?.dbVideo?.s3_url && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: 'rgba(16, 185, 129, 0.14)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ☁️ Đã đẩy S3 & DB
                  </span>
                )}
                {(() => {
                  const modalPub = getVideoPublishFlags(detailData?.dbVideo);
                  const isTogglingModal = togglingPublishId === editingVideoId;
                  return (
                    <>
                      <button
                        type="button"
                        disabled={isTogglingModal}
                        onClick={(e) => handleTogglePublishedFlag(editingVideoId, e)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: '999px',
                          cursor: isTogglingModal ? 'wait' : 'pointer',
                          background: modalPub.isPublished
                            ? 'rgba(16, 185, 129, 0.22)'
                            : 'rgba(148, 163, 184, 0.12)',
                          color: modalPub.isPublished ? '#6ee7b7' : '#94a3b8',
                          border: modalPub.isPublished
                            ? '1px solid rgba(16, 185, 129, 0.55)'
                            : '1px dashed rgba(148, 163, 184, 0.4)',
                          whiteSpace: 'nowrap',
                        }}
                        title={
                          modalPub.isPublished
                            ? 'Bấm để bỏ gắn cờ Đã đăng'
                            : 'Bấm để gắn cờ Đã đăng thủ công'
                        }
                      >
                        {isTogglingModal ? '⏳...' : modalPub.isPublished ? '✅ Đã đăng' : '🏳️ Chưa đăng'}
                      </button>
                      {modalPub.hasYt && (
                        <a
                          href={modalPub.ytUrl || 'https://studio.youtube.com'}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: '999px',
                            background: 'rgba(239, 68, 68, 0.16)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.45)',
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          🔴 YouTube ↗
                        </a>
                      )}
                      {modalPub.hasFb && (
                        <a
                          href={modalPub.fbUrl || 'https://www.facebook.com'}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: '999px',
                            background: 'rgba(59, 130, 246, 0.16)',
                            color: '#93c5fd',
                            border: '1px solid rgba(59, 130, 246, 0.45)',
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          🔵 Facebook ↗
                        </a>
                      )}
                      {modalPub.hasTt && (
                        <a
                          href="https://www.tiktok.com/tiktokstudio/content"
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: '999px',
                            background: 'rgba(236, 72, 153, 0.16)',
                            color: '#f9a8d4',
                            border: '1px solid rgba(236, 72, 153, 0.45)',
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          🎵 TikTok ↗
                        </a>
                      )}
                    </>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                {detailData?.dbVideo && (
                  <button
                    type="button"
                    onClick={() => {
                      const vid = detailData.dbVideo;
                      setEditingVideoId(null);
                      onOpenPublishModal({
                        ...vid,
                        playlist_name: resolveVideoPlaylistForPublish(
                          vid,
                          `${editTitle || vid.title || ''} ${editCaption || vid.caption || ''}`
                        ),
                      });
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '10px',
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.24) 0%, rgba(5, 150, 105, 0.32) 100%)',
                      color: '#6ee7b7',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    🚀 Đăng YouTube / Facebook / TikTok
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingVideoId(null)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '10px',
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  ✕ Đóng
                </button>
              </div>
            </div>

            {/* ── Modal Body ── */}
            {!detailData ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                ⏳ Đang tải dữ liệu video...
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    isLongStudio || detailData?.narration?.aspectRatio === '16:9' || detailData?.dbVideo?.aspect_ratio === '16:9'
                      ? '450px 1fr'
                      : '300px 1fr',
                  gap: '18px',
                  padding: '18px 22px',
                  overflowY: 'auto',
                  alignItems: 'stretch',
                }}
              >
                {/* Left Column: Video Player Preview + Clean S3 Cloud Actions */}
                <div
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: '14px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: '#000',
                      border: '1px solid #1e293b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {detailData.files?.uploadMp4 || detailData.files?.draftMp4 ? (
                      <video
                        controls
                        preload="metadata"
                        src={`/api/shorts-studio/file/${detailData.files.uploadMp4 || detailData.files.draftMp4}?v=${detailData._cacheKey || 1}`}
                        poster={
                          detailData.files?.coverJpg
                            ? `/api/shorts-studio/file/${detailData.files.coverJpg}?v=${detailData._cacheKey || 1}`
                            : undefined
                        }
                        style={{
                          width: '100%',
                          aspectRatio:
                            isLongStudio || detailData?.narration?.aspectRatio === '16:9' || detailData?.dbVideo?.aspect_ratio === '16:9'
                              ? '16 / 9'
                              : '9 / 16',
                          maxHeight: '470px',
                          objectFit: 'contain',
                          display: 'block',
                          background: '#000',
                        }}
                      />
                    ) : (
                      <div style={{ padding: '60px 16px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                        Chưa có file MP4 đã render.
                      </div>
                    )}
                  </div>

                  {/* Clean S3 Action Card (No ugly wrapped URL text!) */}
                  <div
                    style={{
                      background: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '10px',
                      padding: '10px 12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#34d399' }}>
                        ☁️ Lưu trữ AWS S3 & Database
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#64748b', fontFamily: 'monospace' }}>
                        {detailData.dbVideo?.s3_bucket || 's3-affiliate'}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      {detailData.dbVideo?.s3_url && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(detailData.dbVideo.s3_url);
                              showToast('📋 Đã copy link S3 vào bộ nhớ tạm!');
                            }}
                            style={{
                              padding: '6px 8px',
                              borderRadius: '7px',
                              border: '1px solid #334155',
                              background: '#1e293b',
                              color: '#e2e8f0',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            📋 Copy link S3
                          </button>
                          <a
                            href={detailData.dbVideo.s3_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              padding: '6px 8px',
                              borderRadius: '7px',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                              background: 'rgba(56, 189, 248, 0.1)',
                              color: '#38bdf8',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              textDecoration: 'none',
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ↗ Mở file S3
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Card 1 (Meta) + Card 2 (Script Sentences) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
                  {/* Card 1: Tiêu đề & Nội dung đồng bộ S3 + DB */}
                  <div
                    style={{
                      background: '#090d16',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: '14px',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#38bdf8' }}>
                        📝 1. Tiêu đề & Nội dung bài đăng (YouTube / Facebook / TikTok)
                      </div>
                      <button
                        type="button"
                        disabled={isSavingMeta}
                        onClick={handleSaveTitleAndCaptionToDb}
                        style={{
                          padding: '7px 14px',
                          borderRadius: '8px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: isSavingMeta ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                        }}
                      >
                        {isSavingMeta ? '⏳ Đang lưu & đẩy S3...' : '☁️ Lưu Tiêu Đề & Đẩy lên S3 + DB'}
                      </button>
                    </div>

                    {/* Title + Hashtags side by side */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.25fr 1fr',
                        gap: '10px',
                        marginBottom: '8px',
                      }}
                    >
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          Tiêu đề Video (Title)
                        </label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          style={{
                            width: '100%',
                            background: '#111827',
                            border: '1px solid #263248',
                            borderRadius: '8px',
                            padding: '7px 10px',
                            color: '#f8fafc',
                            fontSize: '13px',
                            fontWeight: 600,
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          Hashtags (cách nhau bởi dấu cách)
                        </label>
                        <input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          style={{
                            width: '100%',
                            background: '#111827',
                            border: '1px solid #263248',
                            borderRadius: '8px',
                            padding: '7px 10px',
                            color: '#7dd3fc',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                        Nội dung mô tả / Caption đầy đủ
                      </label>
                      <textarea
                        rows={2}
                        value={editCaption}
                        onChange={(e) => setEditCaption(e.target.value)}
                        style={{
                          width: '100%',
                          background: '#111827',
                          border: '1px solid #263248',
                          borderRadius: '8px',
                          padding: '7px 10px',
                          color: '#e2e8f0',
                          fontSize: '12.5px',
                          lineHeight: 1.45,
                          fontFamily: 'inherit',
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  </div>

                  {/* Card 2: Sửa Kịch Bản Thoại & Render Lại */}
                  <div
                    style={{
                      background: '#090d16',
                      border: '1px solid #1e293b',
                      borderRadius: '14px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#d2a8ff', whiteSpace: 'nowrap' }}>
                        🎙️ 2. Kịch bản từng câu & Giọng đọc ({editSentences.length} câu)
                      </div>
                      <select
                        value={editVoice}
                        onChange={(e) => setEditVoice(e.target.value)}
                        style={{
                          maxWidth: '360px',
                          width: '100%',
                          background: '#111827',
                          border: '1px solid #263248',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          color: '#38bdf8',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div
                      style={{
                        maxHeight: '235px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '7px',
                        paddingRight: '6px',
                        marginBottom: '12px',
                      }}
                    >
                      {editSentences.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <span
                            style={{
                              minWidth: '30px',
                              height: '28px',
                              borderRadius: '6px',
                              background: '#161f30',
                              border: '1px solid #263248',
                              color: '#94a3b8',
                              fontSize: '11px',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            #{i + 1}
                          </span>
                          <input
                            type="text"
                            value={s.text}
                            onChange={(e) => {
                              const next = [...editSentences];
                              next[i] = { ...next[i], text: e.target.value };
                              setEditSentences(next);
                            }}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              background: '#111827',
                              border: '1px solid #263248',
                              borderRadius: '8px',
                              padding: '7px 11px',
                              color: '#f1f5f9',
                              fontSize: '12.5px',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setEditSentences(editSentences.filter((_, idx) => idx !== i))}
                            title="Xóa câu thoại này"
                            style={{
                              width: '28px',
                              height: '28px',
                              background: 'rgba(248, 81, 73, 0.08)',
                              border: '1px solid rgba(248, 81, 73, 0.3)',
                              color: '#f87171',
                              borderRadius: '7px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '10px',
                        borderTop: '1px solid #1e293b',
                        marginTop: 'auto',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setEditSentences([...editSentences, { id: `s${editSentences.length + 1}`, text: '' }])
                        }
                        style={{
                          padding: '7px 14px',
                          borderRadius: '8px',
                          border: '1px dashed #334155',
                          background: '#111827',
                          color: '#94a3b8',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        + Thêm câu thoại
                      </button>

                      <button
                        type="button"
                        disabled={isRebuilding}
                        onClick={handleRebuildVideo}
                        style={{
                          padding: '8px 18px',
                          borderRadius: '8px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                          color: '#fff',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          cursor: isRebuilding ? 'wait' : 'pointer',
                          boxShadow: '0 4px 12px rgba(22, 163, 74, 0.3)',
                        }}
                      >
                        {isRebuilding ? '⏳ Đang gửi lệnh...' : '🔄 Đọc lại giọng & Render lại MP4'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

