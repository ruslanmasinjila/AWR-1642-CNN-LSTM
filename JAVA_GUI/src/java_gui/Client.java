/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package java_gui;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.Socket;
import java.util.logging.Level;
import java.util.logging.Logger;

public class Client {

    private static Socket socket;
    private String host = "localhost";
    private int port = 65431;

    InetAddress address;
    OutputStream os;
    OutputStreamWriter osw;
    BufferedWriter bw;

    public Client() {

    }

    public void connectToServer() {
        try {
            address = InetAddress.getByName(host);
            socket = new Socket(address, port);

            //Send the message to the server
            os = socket.getOutputStream();
            osw = new OutputStreamWriter(os);
            bw = new BufferedWriter(osw);

        } catch (Exception exception) {
            exception.printStackTrace();
        }

    }

    public void sendMessage(String messageToPython) {

        try {
            bw.write(messageToPython);
            bw.flush();
        } catch (IOException ex) {
            Logger.getLogger(Client.class.getName()).log(Level.SEVERE, null, ex);
        }
    }

    public void closeSocket() {
        //Closing the socket
        try {
            socket.close();
        } catch (Exception e) {
            e.printStackTrace();
        }

    }
}
