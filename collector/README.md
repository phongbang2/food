# Python collector

Bộ thu thập này lấy địa điểm ăn uống công khai từ OpenStreetMap/Overpass, chuẩn hóa dữ liệu, loại trùng với tab `HCM`, rồi tạo:

- `out/candidates.json`
- `out/candidates.csv`

Mặc định nó **không ghi trực tiếp vào Google Sheet**. Mỗi địa điểm vẫn phải được kiểm tra trong tab `Review` trước khi duyệt vào `HCM`.

## Chạy trên Windows

Cần Python 3.10 trở lên:

```powershell
py collector/food_collector.py --district "Quận 2" --category all
```

Một số ví dụ:

```powershell
py collector/food_collector.py --district "Quận 5" --category restaurant --limit 50
py collector/food_collector.py --category cafe --limit 100
```

## Gửi tự động vào hàng chờ Review

1. Dán bản `admin/Code.gs` mới vào Apps Script rồi lưu.
2. Chọn hàm `setImportToken`, bấm Chạy và cấp quyền. Sao chép token trong kết quả thực thi/log.
3. Deploy lại Web app với:
   - Execute as: Me
   - Who has access: Anyone
4. Sao chép `.env.example` thành `.env`, điền URL Web app và token.
5. Chạy:

```powershell
py collector/food_collector.py --district "Quận 2" --push
```

Token bảo vệ riêng cho webhook Python. Tuy vậy, khi Web app để `Anyone`, trang quản trị cũng có thể được mở công khai; chỉ bật chế độ này nếu bạn chấp nhận. Nếu không muốn mở Web app, hãy dùng JSON/CSV và nhập qua trang Review thủ công.

## Lưu ý dữ liệu

Dữ liệu OpenStreetMap có thể thiếu tên đường, giờ mở cửa hoặc quận. Kết quả chỉ là đề xuất. Khi hiển thị dữ liệu OSM trong ứng dụng, cần giữ attribution OpenStreetMap và tuân thủ giấy phép ODbL.


## Ứng dụng giao diện Windows

Không cần chạy PowerShell từng lệnh. Sau khi đã cấu hình `collector/.env`, mở thư mục `collector` và nhấp đúp:

```text
run_gui.bat
```

Trong app:

1. Chọn quận, loại địa điểm và số lượng.
2. Bấm **Tìm quán**.
3. Chọn các dòng cần kiểm tra; nhấp đúp để mở Google Maps.
4. Bấm **Approve → Đưa vào hàng chờ Review**.
5. Mở trang Review để kiểm tra và duyệt vào tab `HCM`.

Nút Approve chỉ đưa dữ liệu vào hàng chờ Review, không ghi thẳng vào dữ liệu chính.

## Tìm tín hiệu quán hot miễn phí

Trong giao diện Windows, bấm **Tìm tín hiệu hot** để tìm các bài review và địa điểm nổi bật theo quận hoặc từ khóa. Tính năng này:

- Dùng RSS công khai của Google News và Bing News, không cần API key.
- Chỉ lưu tiêu đề, nguồn, ngày đăng và link để bạn mở kiểm tra.
- Có cache 30 phút để giảm số lần gọi mạng và vẫn hoạt động tốt khi nguồn chậm.
- Có truy vấn gợi ý cho review web, TikTok và YouTube nhưng không tự đăng nhập, vượt CAPTCHA hoặc cào trang nội dung.
- Không dùng tín hiệu hot để tự suy ra địa chỉ. Bạn vẫn cần mở link, xác minh Google Maps rồi Approve.

RSS chỉ là nguồn gợi ý xu hướng; dữ liệu địa điểm chính vẫn cần đối chiếu với OSM/Google Maps và duyệt thủ công.
