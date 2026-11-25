#!/usr/bin/env python3
"""Open the private AIMeter admin page through the owner's SSH tunnel."""
import json
import re
import sys
from pathlib import Path

if not (sys.stdin.isatty() and sys.stdout.isatty()):
    sys.exit("Mở qua SSH với tùy chọn -t để dùng trang quản trị.")

credentials = json.loads(Path("/etc/aiking-aimeter/bootstrap.json").read_text())
route = credentials["adminRoutePath"]
if not re.fullmatch(r"[A-Za-z0-9]{32}", route):
    sys.exit("Đường dẫn quản trị trong cấu hình chưa hợp lệ.")

print("Mở địa chỉ này trên trình duyệt của máy đang kết nối SSH:")
print("http://127.0.0.1:3186/" + route)
print("Trong AIMeter, chọn Add Provider để liên kết tài khoản AI.")
try:
    if input("Để xem mật khẩu quản trị ban đầu tại terminal riêng này, gõ xem và nhấn Enter. Để bỏ qua, nhấn Enter: ").strip() == "xem":
        print(credentials["adminPassword"], flush=True)
    input("Giữ cửa sổ này mở trong khi sử dụng. Nhấn Enter để đóng kết nối. ")
except (EOFError, KeyboardInterrupt):
    pass
