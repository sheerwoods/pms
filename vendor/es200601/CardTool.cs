// CardTool —— es200601.dll (32位) 命令行桥接助手
// 编译：csc /platform:x86 /nologo /out:CardTool.exe CardTool.cs
// 必须兼容 C# 5（.NET Framework 自带 csc 不支持 C#6+ 语法）
//
// 协议：stdin 读一行，空格分隔，每个字段为 UTF-8 的 base64
//       第一字段为命令名，其余为参数
// 输出：stdout 一行
//       成功：OK <code> [<key>=<base64值> ...]
//       失败：ERR <code> <base64错误信息>
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

static class CardTool
{
    const string Dll = "es200601.dll";

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int GetVersion();

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int OpenDatabase(string Username, string Password);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int CloseDatabase();

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int SetSystemParameter(int CardType, int Comm);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteGuestCard3(string GuestName, int GuestCardType, string RoomNo,
        string SpecialRoomList, string BeginTime, string EndTime, ref int GetCardNo,
        int Floor1, int Floor2, int Floor3, string ExCardMess);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int ReadCardData5(ref int GetCardType, ref int GetCardNo, ref int GuestBatchID,
        StringBuilder RoomNo, StringBuilder BeginTime, StringBuilder EndTime,
        ref int SpecialRoomList, ref int Floor1, ref int Floor2, ref int Floor3, StringBuilder ExCardMess);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int ReadCardData(ref int GetCardType, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int CheckOut(string RoomNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int CheckOut2(int CardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteMasterCard(string LimitedTime, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteEmergencyCard(string LimitedTime, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteMultiFloorCard(string LimitedTime, int BuildingNo, int FloorNo1,
        int FloorNo2, string SpecialRoomTypeList, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteEmployeeCard(string LimitedTime, string SpecialRoomList, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteClockCard(string Time, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteRoomLockNoCard(string RoomNo, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WritePassageLockNoCard(string RoomNo, int PassageType, string SpecialRoomList, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteSpecialRoomLockNoCard(string RoomNo, int SpecialRoomType, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteReportLossCard(int LossCardNo, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int WriteReleaseCard(int ReleaseCardNo, ref int GetCardNo);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int ClearCardData();

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern uint GetCardSN();

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int m1_read(byte block, StringBuilder CardData);

    [DllImport(Dll, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.StdCall)]
    static extern int m1_write(byte block, string CardData);

    static string Dec(string b64)
    {
        if (string.IsNullOrEmpty(b64)) return "";
        return Encoding.UTF8.GetString(Convert.FromBase64String(b64));
    }

    static int Num(string b64)
    {
        return int.Parse(Dec(b64));
    }

    static string Enc(string s)
    {
        if (s == null) s = "";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(s));
    }

    static void Out(string s)
    {
        Console.Out.Write(s);
        Console.Out.Write("\n");
        Console.Out.Flush();
    }

    static void Fail(int code, string msg)
    {
        Out("ERR " + code.ToString() + " " + Enc(msg));
    }

    static void Ok(int code, Dictionary<string, string> data)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("OK ").Append(code);
        if (data != null)
        {
            foreach (KeyValuePair<string, string> kv in data)
            {
                sb.Append(' ').Append(kv.Key).Append('=').Append(Enc(kv.Value));
            }
        }
        Out(sb.ToString());
    }

    static void Main()
    {
        try
        {
            Console.OutputEncoding = Encoding.UTF8;
            string line = Console.In.ReadLine();
            if (line == null) { Fail(-999, "无输入"); return; }
            string[] f = line.Split(' ');
            string cmd = f.Length > 0 ? f[0] : "";

            if (cmd == "version")
            {
                Dictionary<string, string> d = new Dictionary<string, string>();
                d["version"] = GetVersion().ToString();
                Ok(0, d);
                return;
            }

            // 参数：argv[1]=user, argv[2]=pass
            if (f.Length < 3) { Fail(-999, "参数不足"); return; }
            string user = Dec(f[1]);
            string pass = Dec(f[2]);
            int rc = OpenDatabase(user, pass);
            if (rc != 0) { Fail(rc, "打开数据库失败"); return; }

            // 写卡器串口：仅当显式配置（>0）时设置，否则沿用门锁系统自身的发卡机配置
            int sysPort = f.Length > 3 ? Num(f[3]) : 0;
            if (sysPort > 0) SetSystemParameter(6, sysPort);

            int ret;
            Dictionary<string, string> outData = new Dictionary<string, string>();
            try
            {
                switch (cmd)
                {
                    case "writeGuestCard":
                    {
                        // user pass port name cardType roomNo special begin end f1 f2 f3 ex
                        string name = Dec(f[4]);
                        int cardType = Num(f[5]);
                        string roomNo = Dec(f[6]);
                        string special = Dec(f[7]);
                        string begin = Dec(f[8]);
                        string end = Dec(f[9]);
                        int f1 = Num(f[10]), f2 = Num(f[11]), f3 = Num(f[12]);
                        string ex = Dec(f[13]);
                        int cardNo = 0;
                        ret = WriteGuestCard3(name, cardType, roomNo, special, begin, end, ref cardNo, f1, f2, f3, ex);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "readCard":
                    {
                        int cardType = 0, cardNo = 0, batch = 0, special = 0, f1 = 0, f2 = 0, f3 = 0;
                        StringBuilder roomNo = new StringBuilder(16);
                        StringBuilder begin = new StringBuilder(16);
                        StringBuilder end = new StringBuilder(16);
                        StringBuilder ex = new StringBuilder(64);
                        ret = ReadCardData5(ref cardType, ref cardNo, ref batch, roomNo, begin, end,
                            ref special, ref f1, ref f2, ref f3, ex);
                        if (ret == 0)
                        {
                            outData["cardType"] = cardType.ToString();
                            outData["cardNo"] = cardNo.ToString();
                            outData["batch"] = batch.ToString();
                            outData["roomNo"] = roomNo.ToString();
                            outData["begin"] = begin.ToString();
                            outData["end"] = end.ToString();
                            outData["special"] = special.ToString();
                            outData["floor1"] = f1.ToString();
                            outData["floor2"] = f2.ToString();
                            outData["floor3"] = f3.ToString();
                            outData["exCardMess"] = ex.ToString();
                        }
                        break;
                    }
                    case "readCard2":
                    {
                        int cardType = 0, cardNo = 0;
                        ret = ReadCardData(ref cardType, ref cardNo);
                        if (ret == 0)
                        {
                            outData["cardType"] = cardType.ToString();
                            outData["cardNo"] = cardNo.ToString();
                        }
                        break;
                    }
                    case "checkout":
                    {
                        // user pass port roomNo
                        ret = CheckOut(Dec(f[4]));
                        break;
                    }
                    case "checkout2":
                    {
                        // user pass port cardNo
                        ret = CheckOut2(Num(f[4]));
                        break;
                    }
                    case "master":
                    case "emergency":
                    {
                        int cardNo = 0;
                        ret = cmd == "master"
                            ? WriteMasterCard(Dec(f[4]), ref cardNo)
                            : WriteEmergencyCard(Dec(f[4]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "multiFloor":
                    {
                        int cardNo = 0;
                        ret = WriteMultiFloorCard(Dec(f[4]), Num(f[5]), Num(f[6]), Num(f[7]), Dec(f[8]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "employee":
                    {
                        int cardNo = 0;
                        ret = WriteEmployeeCard(Dec(f[4]), Dec(f[5]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "clock":
                    {
                        int cardNo = 0;
                        ret = WriteClockCard(Dec(f[4]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "roomLockNo":
                    {
                        int cardNo = 0;
                        ret = WriteRoomLockNoCard(Dec(f[4]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "passageLockNo":
                    {
                        int cardNo = 0;
                        ret = WritePassageLockNoCard(Dec(f[4]), Num(f[5]), Dec(f[6]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "specialRoomLockNo":
                    {
                        int cardNo = 0;
                        ret = WriteSpecialRoomLockNoCard(Dec(f[4]), Num(f[5]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "reportLoss":
                    {
                        int cardNo = 0;
                        ret = WriteReportLossCard(Num(f[4]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "release":
                    {
                        int cardNo = 0;
                        ret = WriteReleaseCard(Num(f[4]), ref cardNo);
                        outData["cardNo"] = cardNo.ToString();
                        break;
                    }
                    case "clear":
                    {
                        ret = ClearCardData();
                        break;
                    }
                    case "cardSN":
                    {
                        uint sn = GetCardSN();
                        ret = sn == 0 ? -7 : 0;
                        outData["sn"] = sn.ToString();
                        break;
                    }
                    case "m1read":
                    {
                        int block = Num(f[4]);
                        StringBuilder data = new StringBuilder(64);
                        ret = m1_read((byte)block, data);
                        if (ret == 0) outData["data"] = data.ToString();
                        break;
                    }
                    case "m1write":
                    {
                        int block = Num(f[4]);
                        ret = m1_write((byte)block, Dec(f[5]));
                        break;
                    }
                    default:
                        Fail(-998, "未知命令: " + cmd);
                        return;
                }
            }
            finally
            {
                CloseDatabase();
            }

            if (ret == 0) Ok(ret, outData);
            else
            {
                // 附带已解析出的数据（读卡失败时通常为空）
                StringBuilder sb = new StringBuilder();
                sb.Append("ERR ").Append(ret).Append(' ').Append(Enc(CodeMsg(ret)));
                if (outData.Count > 0)
                {
                    foreach (KeyValuePair<string, string> kv in outData)
                        sb.Append(' ').Append(kv.Key).Append('=').Append(Enc(kv.Value));
                }
                Out(sb.ToString());
            }
        }
        catch (Exception e)
        {
            Fail(-997, e.Message);
        }
    }

    static string CodeMsg(int code)
    {
        switch (code)
        {
            case 0: return "成功";
            case -1: return "日期/时间格式错误";
            case -2: return "写卡失败";
            case -3: return "楼号错误";
            case -4: return "楼层错误";
            case -5: return "房号错误";
            case -6: return "卡号错误";
            case -7: return "读卡失败";
            case -8: return "查询房号失败";
            case -9: return "特殊房号错误";
            case -10: return "非本系统卡片";
            case -100: return "数据库未打开";
            case -101: return "连接数据库失败";
            case -102: return "关闭数据库失败";
            case -103: return "数据库未创建";
            case -200: return "打开串口失败";
            case -201: return "连接数据采集器失败";
            case -202: return "无效数据";
            case -300: return "卡块错误";
            default: return "操作失败（代码 " + code + "）";
        }
    }
}
