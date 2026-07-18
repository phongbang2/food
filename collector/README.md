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
