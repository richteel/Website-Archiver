namespace WebsiteArchiverControlApp;

partial class Form1
{
    /// <summary>
    ///  Required designer variable.
    /// </summary>
    private System.ComponentModel.IContainer components = null;

    /// <summary>
    ///  Clean up any resources being used.
    /// </summary>
    /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
    protected override void Dispose(bool disposing)
    {
        if (disposing && (components != null))
        {
            components.Dispose();
        }
        base.Dispose(disposing);
    }

    #region Windows Form Designer generated code

    /// <summary>
    ///  Required method for Designer support - do not modify
    ///  the contents of this method with the code editor.
    /// </summary>
    private void InitializeComponent()
    {
        lblStatusTitle = new Label();
        lblStatus = new Label();
        btnStart = new Button();
        btnStop = new Button();
        btnRefresh = new Button();
        btnOpenSite = new Button();
        chkOpenBrowser = new CheckBox();
        lblPort = new Label();
        numPort = new NumericUpDown();
        txtOutput = new TextBox();
        ((System.ComponentModel.ISupportInitialize)numPort).BeginInit();
        SuspendLayout();
        // 
        // lblStatusTitle
        // 
        lblStatusTitle.AutoSize = true;
        lblStatusTitle.Location = new Point(12, 12);
        lblStatusTitle.Name = "lblStatusTitle";
        lblStatusTitle.Size = new Size(42, 15);
        lblStatusTitle.TabIndex = 0;
        lblStatusTitle.Text = "Status:";
        // 
        // lblStatus
        // 
        lblStatus.BorderStyle = BorderStyle.FixedSingle;
        lblStatus.Location = new Point(62, 9);
        lblStatus.Name = "lblStatus";
        lblStatus.Size = new Size(356, 23);
        lblStatus.TabIndex = 1;
        lblStatus.Text = "Checking...";
        lblStatus.TextAlign = ContentAlignment.MiddleLeft;
        // 
        // btnStart
        // 
        btnStart.Location = new Point(12, 70);
        btnStart.Name = "btnStart";
        btnStart.Size = new Size(95, 28);
        btnStart.TabIndex = 5;
        btnStart.Text = "Start";
        btnStart.UseVisualStyleBackColor = true;
        // 
        // btnStop
        // 
        btnStop.Location = new Point(113, 70);
        btnStop.Name = "btnStop";
        btnStop.Size = new Size(95, 28);
        btnStop.TabIndex = 6;
        btnStop.Text = "Stop";
        btnStop.UseVisualStyleBackColor = true;
        // 
        // btnRefresh
        // 
        btnRefresh.Location = new Point(214, 70);
        btnRefresh.Name = "btnRefresh";
        btnRefresh.Size = new Size(95, 28);
        btnRefresh.TabIndex = 7;
        btnRefresh.Text = "Refresh";
        btnRefresh.UseVisualStyleBackColor = true;
        // 
        // btnOpenSite
        // 
        btnOpenSite.Location = new Point(315, 70);
        btnOpenSite.Name = "btnOpenSite";
        btnOpenSite.Size = new Size(103, 28);
        btnOpenSite.TabIndex = 8;
        btnOpenSite.Text = "Open Site";
        btnOpenSite.UseVisualStyleBackColor = true;
        // 
        // chkOpenBrowser
        // 
        chkOpenBrowser.AutoSize = true;
        chkOpenBrowser.Checked = true;
        chkOpenBrowser.CheckState = CheckState.Checked;
        chkOpenBrowser.Location = new Point(12, 43);
        chkOpenBrowser.Name = "chkOpenBrowser";
        chkOpenBrowser.Size = new Size(143, 19);
        chkOpenBrowser.TabIndex = 2;
        chkOpenBrowser.Text = "Open browser on start";
        chkOpenBrowser.UseVisualStyleBackColor = true;
        // 
        // lblPort
        // 
        lblPort.AutoSize = true;
        lblPort.Location = new Point(287, 44);
        lblPort.Name = "lblPort";
        lblPort.Size = new Size(29, 15);
        lblPort.TabIndex = 3;
        lblPort.Text = "Port";
        // 
        // numPort
        // 
        numPort.Location = new Point(322, 41);
        numPort.Maximum = new decimal(new int[] { 65535, 0, 0, 0 });
        numPort.Minimum = new decimal(new int[] { 1, 0, 0, 0 });
        numPort.Name = "numPort";
        numPort.Size = new Size(96, 23);
        numPort.TabIndex = 4;
        numPort.Value = new decimal(new int[] { 8090, 0, 0, 0 });
        // 
        // txtOutput
        // 
        txtOutput.Location = new Point(12, 104);
        txtOutput.Multiline = true;
        txtOutput.Name = "txtOutput";
        txtOutput.ReadOnly = true;
        txtOutput.ScrollBars = ScrollBars.Vertical;
        txtOutput.Size = new Size(406, 189);
        txtOutput.TabIndex = 9;
        // 
        // Form1
        // 
        AutoScaleDimensions = new SizeF(7F, 15F);
        AutoScaleMode = AutoScaleMode.Font;
        ClientSize = new Size(430, 305);
        Controls.Add(txtOutput);
        Controls.Add(numPort);
        Controls.Add(lblPort);
        Controls.Add(chkOpenBrowser);
        Controls.Add(btnOpenSite);
        Controls.Add(btnRefresh);
        Controls.Add(btnStop);
        Controls.Add(btnStart);
        Controls.Add(lblStatus);
        Controls.Add(lblStatusTitle);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        Name = "Form1";
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Website Archiver Control";
        ((System.ComponentModel.ISupportInitialize)numPort).EndInit();
        ResumeLayout(false);
        PerformLayout();
    }

    #endregion

    private System.Windows.Forms.Label lblStatusTitle;
    private System.Windows.Forms.Label lblStatus;
    private System.Windows.Forms.Button btnStart;
    private System.Windows.Forms.Button btnStop;
    private System.Windows.Forms.Button btnRefresh;
    private System.Windows.Forms.Button btnOpenSite;
    private System.Windows.Forms.CheckBox chkOpenBrowser;
    private System.Windows.Forms.Label lblPort;
    private System.Windows.Forms.NumericUpDown numPort;
    private System.Windows.Forms.TextBox txtOutput;
}
